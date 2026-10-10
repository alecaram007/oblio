// Il server web: pagine statiche, moduli condivisi e API JSON, su un archivio temporaneo.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { creaServer, PORTA_PREDEFINITA } from '../server.mjs';
import { nuovoArchivio, pulisci, DIARIO, cartellaTemporanea } from './aiuto.mjs';
import { nuovaImmagine } from '../lib/immagine.js';
import { codificaJpeg, sipsDisponibile } from '../lib/sips.mjs';

let server, base, archivio, url;

before(async () => {
    ({ base, archivio } = nuovoArchivio());
    server = creaServer({ archivio });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    await new Promise(ok => server.close(ok));
    pulisci(base);
});

const json = async (via, opzioni) => {
    const r = await fetch(url + via, opzioni);
    return { status: r.status, dati: await r.json() };
};
const comando = (comando, argomento, extra = {}) => json('/api/comando', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comando, argomento, ...extra }),
});
const carica = (nome, dati, modificato) => json(`/api/aggiungi?nome=${encodeURIComponent(nome)}${modificato ? `&modificato=${modificato}` : ''}`, { method: 'POST', body: dati });

test('porta predefinita assegnata', () => {
    assert.equal(PORTA_PREDEFINITA, 5178);
});

test('pagine statiche e moduli condivisi', async () => {
    for (const [via, tipo] of [['/', 'text/html'], ['/stile.css', 'text/css'], ['/app.js', 'text/javascript'], ['/icona.svg', 'image/svg+xml'],
        ['/lib/formato.js', 'text/javascript'], ['/lib/modello.js', 'text/javascript']]) {
        const r = await fetch(url + via);
        assert.equal(r.status, 200, via);
        assert.ok(r.headers.get('content-type').startsWith(tipo), via);
        const testo = await r.text();
        if (via.startsWith('/lib/')) assert.ok(!/from 'node:/.test(testo), `${via} non usa moduli di Node`);
    }
    const html = await (await fetch(url + '/')).text();
    assert.match(html, /<html lang="it">/);
    assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org[^"]*/g, '')), 'nessuna risorsa esterna: funziona offline');
    for (const via of ['/lib/cifra.mjs', '/lib/archivio.mjs', '/../server.mjs', '/%2e%2e/server.mjs', '/non-esiste.html']) {
        assert.notEqual((await fetch(url + via)).status, 200, via);
    }
});

test('stato, aggiunta dal browser, anteprima, apertura e ricordi', async () => {
    let r = await json('/api/stato');
    assert.equal(r.status, 200);
    assert.equal(r.dati.esiste, true);
    assert.equal(r.dati.voci.length, 0);
    assert.equal(r.dati.radice, archivio);

    const quando = new Date(2025, 5, 1, 10, 0).getTime();
    r = await carica('diario estate.txt', DIARIO, quando);
    assert.equal(r.status, 200);
    assert.ok(r.dati.messaggi.some(m => /\+ diario estate\.txt/.test(m.testo)));
    assert.equal(r.dati.stato.voci.length, 1);
    const v = r.dati.stato.voci[0];
    assert.match(v.descrizione, /· 1 giu 2025$/, 'la data del file arriva dal browser');

    let a = await fetch(`${url}/api/anteprima/${v.id}`);
    assert.equal(a.status, 200);
    assert.equal(await a.text(), DIARIO);

    r = await comando('apri', v.id);
    assert.equal(r.dati.ok, true);
    assert.equal(r.dati.risultato.apertura.fonte, 'originale, intatto');
    assert.equal(r.dati.risultato.apertura.testo, DIARIO);
    a = await fetch(url + r.dati.risultato.apertura.url);
    assert.equal(a.status, 200);
    assert.equal(await a.text(), DIARIO);
    assert.equal(r.dati.stato.voci[0].accessi, 1);
    assert.equal((await fetch(`${url}/api/ricordi/..%2F.oblio%2Fchiavi.json`)).status, 404);
});

test('tempo, velocità, cerca, domani, fissa, dimentica con conferma', async () => {
    await carica('note.txt', 'Una nota sul mare. Una seconda frase.');
    let r = await comando('tempo', '130');
    assert.ok(r.dati.messaggi.some(m => /In questo tempo Oblio ha dimenticato:/.test(m.testo)));
    assert.equal(r.dati.stato.offsetGiorni, 130);
    assert.equal(r.dati.stato.voci.find(v => v.nome === 'note.txt').stato, 'sbiadito');
    r = await comando('domani');
    assert.ok(Array.isArray(r.dati.risultato.previsioni));
    r = await comando('cerca', 'mare');
    assert.ok(r.dati.risultato.trovati.length >= 1);
    assert.deepEqual(r.dati.risultato.trovati.find(t => t.nome === 'note.txt').dove, ['nella traccia', 'nel testo (riassunto)']);
    r = await comando('velocita', 'elefante');
    assert.equal(r.dati.stato.velocita, 'elefante');
    r = await comando('fissa', 'note.txt');
    assert.equal(r.dati.stato.voci.find(v => v.nome === 'note.txt').fissato, true);
    r = await comando('dimentica', 'note.txt');
    assert.equal(r.dati.risultato.dimenticato, false, 'senza conferma non succede niente');
    r = await comando('dimentica', 'note.txt', { conferma: true });
    assert.equal(r.dati.risultato.dimenticato, true);
    assert.ok(!r.dati.stato.voci.some(v => v.nome === 'note.txt'));
    r = await comando('tempo', 'reset');
    assert.equal(r.dati.stato.offsetGiorni, 0);
    r = await comando('velocita', 'normale');
    assert.equal(r.dati.stato.velocita, 'normale');
});

test('errori chiari e richieste rifiutate', async () => {
    let r = await comando('apri', 'non-esiste');
    assert.equal(r.status, 400);
    assert.equal(r.dati.errore, "Nessun file chiamato 'non-esiste' nell'archivio.");
    r = await comando('aiuto');
    assert.equal(r.status, 400);
    r = await json('/api/comando', { method: 'POST', headers: { Origin: 'http://altro.sito' }, body: '{}' });
    assert.equal(r.status, 403);
    r = await carica('.nascosto', 'x');
    assert.equal(r.status, 400);
    r = await json('/api/anteprima/nessuno');
    assert.equal(r.status, 404);
});

test('anteprima di un\'immagine: lo strato medio, in JPEG', { skip: !sipsDisponibile() && 'sips non disponibile' }, async () => {
    const img = nuovaImmagine(900, 600, [110, 170, 230, 255]);
    const r = await carica('cielo.jpg', codificaJpeg(img, 85));
    const v = r.dati.stato.voci.find(x => x.nome === 'cielo.jpg');
    assert.equal(v.tipo, 'immagine');
    const a = await fetch(`${url}/api/anteprima/${v.id}`);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('content-type'), 'image/jpeg');
    assert.equal(a.headers.get('x-oblio-strato'), 'media');
});

test('senza archivio: la pagina propone di crearlo', async () => {
    const vuota = cartellaTemporanea();
    const s = creaServer({ archivio: path.join(vuota, 'nuovo') });
    await new Promise(ok => s.listen(0, '127.0.0.1', ok));
    try {
        const u = `http://127.0.0.1:${s.address().port}`;
        let r = await (await fetch(`${u}/api/stato`)).json();
        assert.equal(r.esiste, false);
        r = await (await fetch(`${u}/api/comando`, { method: 'POST', body: JSON.stringify({ comando: 'crea' }) })).json();
        assert.equal(r.ok, true);
        assert.equal(r.stato.esiste, true);
        assert.ok(fs.existsSync(path.join(vuota, 'nuovo', '.oblio', 'stato.json')));
    } finally {
        await new Promise(ok => s.close(ok));
        pulisci(vuota);
    }
});

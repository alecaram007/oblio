// Regressioni trovate dalla revisione indipendente: ogni test riproduce un difetto
// (divergenza dalla versione Windows, crash o falla del server) che ora è corretto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import { MAC, nuovoArchivio, pulisci, oblio, oblioErrore, scriviFile, voce, contesto, cartellaTemporanea } from './aiuto.mjs';
import { fattore } from '../lib/modello.js';
import { creaServer } from '../server.mjs';

test('tempo RESET: come "-eq \'reset\'" di PowerShell, maiuscole e minuscole non contano', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'tempo', '30');
        assert.match(oblio(archivio, 'tempo', 'Reset').testo, /Orologio riportato a oggi/);
        assert.equal(contesto(archivio).stato.offsetGiorni, 0);
        oblio(archivio, 'tempo', '5');
        oblio(archivio, 'tempo', 'RESET');
        assert.equal(contesto(archivio).stato.offsetGiorni, 0);
    } finally { pulisci(base); }
});

test('velocita constructor/__proto__: rifiutate come su Windows, mai NaN nella vitalità', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota. Due note.'));
        for (const nome of ['constructor', '__proto__', 'hasownproperty']) {
            assert.equal(oblioErrore(archivio, 'velocita', nome),
                `Velocità sconosciuta: '${nome}'. Scegli tra: elefante, normale, pesce-rosso`);
        }
        assert.equal(contesto(archivio).stato.velocita, 'normale');
        // uno stato.json già rovinato vale "normale", come $VELOCITA[...] nullo su Windows
        assert.equal(fattore({ velocita: 'constructor' }), 1);
        assert.equal(fattore({ velocita: 'toString' }), 1);
        const p = path.join(archivio, '.oblio', 'stato.json');
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        s.velocita = 'constructor';
        fs.writeFileSync(p, JSON.stringify(s));
        const r = oblio(archivio, 'stato');
        assert.ok(!r.testo.includes('NaN'), r.testo);
        oblio(archivio, 'tempo', '130');
        assert.equal(voce(archivio, 'note.txt').strati.find(x => x.nome === 'originale').vivo, false, 'il tempo dimentica ancora');
    } finally { pulisci(base); }
});

test('tempo oltre il calendario (anni 1-9999 di .NET): errore e niente salvato', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota. Due note.'));
        for (const g of ['2147483647', '-2147483648', '3000000']) {
            assert.match(oblioErrore(archivio, 'tempo', g), new RegExp(`Numero di giorni non valido: '${g}'`));
            assert.equal(contesto(archivio).stato.offsetGiorni, 0, g);
        }
        const r = oblio(archivio, 'stato');
        assert.ok(!/NaN|undefined/.test(r.testo), r.testo);
        // entro il calendario funziona ancora, anche a passi grandi
        assert.match(oblio(archivio, 'tempo', '100000').testo, /Il tempo avanza di 100000 giorni/);
    } finally { pulisci(base); }
});

test('nomi dei file decomposti (NFD, tipici del Mac): apri, cerca e doppioni come su Windows', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const nfd = 'città perché.txt';   // "città perché.txt" con gli accenti separati
        oblio(archivio, 'aggiungi', scriviFile(path.join(base, 'a'), nfd, 'Il mare di città.'));
        assert.equal(contesto(archivio).stato.voci[0].nome, 'città perché.txt', 'salvato in NFC, come lo scrive Windows');
        assert.match(oblio(archivio, 'apri', 'città perché.txt').testo, /Aperto: {2}città perché\.txt/);
        assert.match(oblio(archivio, 'apri', nfd).testo, /Aperto: {2}città perché\.txt/);
        assert.match(oblio(archivio, 'cerca', 'città').testo, /trovato nel nome/);
        assert.match(oblio(archivio, 'stato').testo, /^ {2}città perché\.txt {9}nitido/m, 'colonne allineate');
        // lo stesso nome nell'altra forma è un doppione
        oblio(archivio, 'aggiungi', scriviFile(path.join(base, 'b'), 'città perché.txt', 'Altro.'));
        assert.deepEqual(contesto(archivio).stato.voci.map(v => v.nome), ['città perché.txt', 'città perché (2).txt']);
    } finally { pulisci(base); }
});

test('oblio.command: i percorsi relativi valgono rispetto alla cartella corrente', () => {
    const base = cartellaTemporanea('oblio cartella con spazi ');
    try {
        scriviFile(base, 'nota.txt', 'Una nota.');
        const lancia = (...args) => spawnSync(path.join(MAC, 'oblio.command'), args, {
            cwd: base, encoding: 'utf8', input: '', env: { ...process.env, NO_COLOR: '1', OBLIO_ARCHIVIO: '' },
        });
        let r = lancia('crea', '-Archivio', './arch');
        assert.equal(r.status, 0, r.stderr);
        assert.ok(fs.existsSync(path.join(base, 'arch', '.oblio', 'stato.json')));
        r = lancia('aggiungi', 'nota.txt', '-Archivio', './arch');
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /\+ nota\.txt/);
        assert.ok(!fs.existsSync(path.join(MAC, 'arch')));
    } finally { pulisci(base); }
});

// --- server ---------------------------------------------------------------

async function conServer(fn) {
    const { base, archivio } = nuovoArchivio();
    const server = creaServer({ archivio });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    try {
        await fn(`http://127.0.0.1:${server.address().port}`, server.address().port, archivio);
    } finally {
        await new Promise(ok => server.close(ok));
        pulisci(base);
    }
}

// http.request permette di scegliere l'intestazione Host (fetch no).
function richiesta(porta, { metodo = 'GET', via = '/', host, corpo, intestazioni = {} } = {}) {
    return new Promise((ok, ko) => {
        const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: via, headers: { ...(host ? { Host: host } : {}), ...intestazioni } }, res => {
            const pezzi = [];
            res.on('data', p => pezzi.push(p));
            res.on('end', () => ok({ status: res.statusCode, headers: res.headers, testo: Buffer.concat(pezzi).toString('utf8') }));
        });
        req.on('error', ko);
        if (corpo) req.write(corpo);
        req.end();
    });
}

test('server: DNS rebinding, un Host che non è locale viene rifiutato', async () => {
    await conServer(async (url, porta) => {
        let r = await richiesta(porta, { via: '/api/stato', host: `cattivo.esempio:${porta}` });
        assert.equal(r.status, 403);
        r = await richiesta(porta, {
            metodo: 'POST', via: '/api/comando', host: `cattivo.esempio:${porta}`,
            intestazioni: { Origin: `http://cattivo.esempio:${porta}`, 'Content-Type': 'application/json' },
            corpo: JSON.stringify({ comando: 'tempo', argomento: '10' }),
        });
        assert.equal(r.status, 403);
        for (const host of [`127.0.0.1:${porta}`, `localhost:${porta}`, `[::1]:${porta}`]) {
            assert.equal((await richiesta(porta, { via: '/api/stato', host })).status, 200, host);
        }
    });
});

test('server: un ricordo .html non gira con i permessi della pagina', async () => {
    await conServer(async url => {
        const pagina = '<script>fetch("/api/comando",{method:"POST",body:\'{"comando":"tempo","argomento":"999"}\'})</script>';
        let r = await fetch(`${url}/api/aggiungi?nome=pagina.html`, { method: 'POST', body: pagina });
        assert.equal(r.status, 200);
        r = await fetch(`${url}/api/comando`, { method: 'POST', body: JSON.stringify({ comando: 'apri', argomento: 'pagina.html' }) });
        const a = (await r.json()).risultato.apertura;
        r = await fetch(url + a.url);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-security-policy'), 'sandbox');
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(await r.text(), pagina);
    });
});

test('server: file troppo grande, il browser riceve il 413 (non una connessione chiusa) e il server resta su', async () => {
    await conServer(async (url, porta) => {
        // 513 MB davvero inviati: prima il server chiudeva la connessione a metà
        const grande = await new Promise((ok, ko) => {
            const req = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: '/api/aggiungi?nome=enorme.bin',
                headers: { 'Content-Length': String(513 * 1024 * 1024) } }, res => {
                const pezzi = []; res.on('data', p => pezzi.push(p));
                res.on('end', () => ok({ status: res.statusCode, dati: JSON.parse(Buffer.concat(pezzi).toString('utf8')) }));
            });
            req.on('error', ko);
            const blocco = Buffer.alloc(1024 * 1024);
            let mandati = 0;
            const manda = () => {
                while (mandati < 513) { mandati++; if (!req.write(blocco)) { req.once('drain', manda); return; } }
                req.end();
            };
            manda();
        });
        assert.equal(grande.status, 413);
        assert.match(grande.dati.errore, /File troppo grande per il caricamento dal browser/);
        assert.equal((await fetch(`${url}/api/stato`)).status, 200, 'il server è ancora acceso');
    });
});

test('server: JSON rotto e %-codifiche rotte sono errori 400 in italiano, non 500 con messaggi di JavaScript', async () => {
    await conServer(async (url, porta) => {
        for (const corpo of ['{rotto', 'null', '"testo"']) {
            const r = await fetch(`${url}/api/comando`, { method: 'POST', body: corpo });
            assert.equal(r.status, 400, corpo);
            assert.equal((await r.json()).errore, 'Richiesta non valida: serve un oggetto JSON.');
        }
        for (const via of ['/%', '/api/anteprima/%E0%A4%A', '/api/ricordi/%']) {
            const r = await richiesta(porta, { via });
            assert.equal(r.status, 400, via);
            assert.equal(JSON.parse(r.testo).errore, 'Indirizzo non valido.');
        }
    });
});

test('pagina: il campo file nascosto non ruba un passo del Tab (si usa l\'etichetta "sceglili dal Mac")', () => {
    const html = fs.readFileSync(path.join(MAC, 'web', 'index.html'), 'utf8');
    assert.match(html, /<input type="file" id="scegli-file"[^>]*tabindex="-1"/);
    assert.match(html, /<label for="scegli-file"[^>]*tabindex="0"/);
});

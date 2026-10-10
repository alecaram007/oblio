// Regressioni trovate dalla seconda passata di revisione (pagina web, server, lanciatori).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { MAC, nuovoArchivio, pulisci, oblio, cartellaTemporanea } from './aiuto.mjs';
import { creaServer } from '../server.mjs';

async function conServer(fn) {
    const { base, archivio } = nuovoArchivio();
    const server = creaServer({ archivio });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    try {
        await fn(`http://127.0.0.1:${server.address().port}`, archivio);
    } finally {
        await new Promise(ok => server.close(ok));
        pulisci(base);
    }
}
const ZITTO = fn => async (...a) => {
    // il server scrive i dettagli degli errori imprevisti nella sua finestra: qui non servono
    const prima = console.error; console.error = () => {};
    try { return await fn(...a); } finally { console.error = prima; }
};

test('server: errori del disco e di JavaScript arrivano alla pagina in italiano, senza i messaggi inglesi di Node', ZITTO(async () => {
    await conServer(async (url, archivio) => {
        const chiavi = path.join(archivio, '.oblio', 'chiavi.json');
        fs.chmodSync(chiavi, 0o000);
        try {
            let r = await fetch(`${url}/api/stato`);
            let e = (await r.json()).errore;
            assert.match(e, /^Accesso al percorso '.*chiavi\.json' negato\.$/);
            r = await fetch(`${url}/api/comando`, { method: 'POST', body: JSON.stringify({ comando: 'stato' }) });
            e = (await r.json()).errore;
            assert.match(e, /^Accesso al percorso '.*chiavi\.json' negato\.$/);
            assert.doesNotMatch(e, /EACCES|permission denied/);
        } finally {
            fs.chmodSync(chiavi, 0o600);
        }
        // stato.json scritto a mano e incoerente: prima "Cannot create property 'strati' on number '5'"
        fs.writeFileSync(path.join(archivio, '.oblio', 'stato.json'), '{"voci":5}');
        const r = await fetch(`${url}/api/stato`);
        assert.equal(r.status, 500);
        const e = (await r.json()).errore;
        assert.match(e, /^Errore imprevisto: l'archivio potrebbe essere rovinato/);
        assert.doesNotMatch(e, /Cannot|property|at /);
    });
}));

test('server: un argomento che non è un testo è una richiesta non valida, non un errore di JavaScript', async () => {
    await conServer(async url => {
        for (const argomento of [{ toString: 1 }, ['mare'], {}]) {
            const r = await fetch(`${url}/api/comando`, { method: 'POST', body: JSON.stringify({ comando: 'cerca', argomento }) });
            assert.equal(r.status, 400);
            assert.equal((await r.json()).errore, "Richiesta non valida: l'argomento deve essere un testo.");
        }
        const r = await fetch(`${url}/api/comando`, { method: 'POST', body: JSON.stringify({ comando: 'tempo', argomento: 7 }) });
        assert.equal(r.status, 200, 'un numero va bene');
    });
});

test('server: nomi caricati fatti di soli spazi o troppo lunghi vengono rifiutati in italiano', async () => {
    await conServer(async url => {
        const carica = nome => fetch(`${url}/api/aggiungi?nome=${encodeURIComponent(nome)}`, { method: 'POST', body: 'ciao' });
        let r = await carica('   ');
        assert.equal(r.status, 400);
        assert.equal((await r.json()).errore, 'Nome di file non valido.');
        r = await carica('a'.repeat(300) + '.txt');
        assert.equal(r.status, 400);
        assert.equal((await r.json()).errore, 'Nome di file troppo lungo: al massimo 255 caratteri.');
        r = await carica('è'.repeat(200) + '.txt');
        assert.equal(r.status, 200, '200 lettere accentate stanno nel limite del Mac');
        r = await carica('../../fuori.txt');
        assert.equal(r.status, 200);
        assert.ok((await r.json()).stato.voci.some(v => v.nome === 'fuori.txt'), 'resta solo il nome, senza ../');
        const st = await (await fetch(`${url}/api/stato`)).json();
        assert.equal(st.voci.length, 2);
    });
});

test('avvia.command: "--archivio ./mio" vale rispetto alla cartella da cui lo lanci, non dentro mac/', async () => {
    const base = cartellaTemporanea('oblio lancio è ');
    const finti = path.join(base, 'finti');
    fs.mkdirSync(finti);
    // un finto "open" davanti nel PATH: il test non apre davvero il browser
    fs.writeFileSync(path.join(finti, 'open'), `#!/bin/bash\necho "$*" > "${path.join(base, 'aperto.txt')}"\n`, { mode: 0o755 });
    oblio(path.join(base, 'mio arch'), 'crea');
    const porta = await new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
    const figlio = spawn(path.join(MAC, 'avvia.command'), ['--archivio', './mio arch'], {
        cwd: base, env: { ...process.env, PATH: `${finti}:${process.env.PATH}`, PORT: String(porta), OBLIO_ARCHIVIO: '' },
    });
    let uscita = '';
    figlio.stdout.on('data', d => { uscita += d; });
    try {
        const fine = Date.now() + 10000;
        while (!fs.existsSync(path.join(base, 'aperto.txt')) && Date.now() < fine) await new Promise(ok => setTimeout(ok, 100));
        assert.equal(fs.readFileSync(path.join(base, 'aperto.txt'), 'utf8').trim(), `http://localhost:${porta}`);
        const st = await (await fetch(`http://127.0.0.1:${porta}/api/stato`)).json();
        assert.equal(st.esiste, true, uscita);
        assert.equal(fs.realpathSync(st.radice), fs.realpathSync(path.join(base, 'mio arch')));
        assert.ok(!fs.existsSync(path.join(MAC, 'mio arch')));
    } finally {
        const chiuso = new Promise(ok => figlio.on('exit', ok));
        figlio.kill('SIGTERM');
        await chiuso;
        pulisci(base);
    }
    // spegnendo il lanciatore si spegne anche il server
    await assert.rejects(fetch(`http://127.0.0.1:${porta}/api/stato`));
});

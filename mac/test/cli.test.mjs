// La riga di comando vera: bin/oblio.mjs lanciato come processo, con gli esempi del README.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import { MAC, cartellaTemporanea, pulisci, scriviFile, DIARIO } from './aiuto.mjs';
import { leggiArgomenti } from '../lib/cli.mjs';

const BIN = path.join(MAC, 'bin', 'oblio.mjs');
function lancia(args, { cwd = MAC, env = {} } = {}) {
    const r = spawnSync(process.execPath, [BIN, ...args], {
        cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', OBLIO_ARCHIVIO: '', ...env },
    });
    return { codice: r.status, out: r.stdout, err: r.stderr };
}

test('leggiArgomenti: stile PowerShell e stile Unix', () => {
    assert.deepEqual(leggiArgomenti(['apri', 'mare.jpg', '-Mostra', '-Archivio', '/tmp/a']),
        { comando: 'apri', argomento: 'mare.jpg', opzioni: { archivio: '/tmp/a', sposta: false, conferma: false, mostra: true } });
    assert.equal(leggiArgomenti(['stato', '--archivio', 'x']).opzioni.archivio, 'x');
    assert.equal(leggiArgomenti(['stato', '--archivio=y z']).opzioni.archivio, 'y z');
    assert.equal(leggiArgomenti(['stato', '-ARCHIVIO:w']).opzioni.archivio, 'w');
    assert.equal(leggiArgomenti(['aggiungi', 'c', '--sposta']).opzioni.sposta, true);
    assert.equal(leggiArgomenti(['dimentica', 'f', '-conferma']).opzioni.conferma, true);
    assert.equal(leggiArgomenti(['dimentica', 'f', '-Conferma:$false']).opzioni.conferma, false);
    assert.deepEqual(leggiArgomenti(['tempo', '-30']).argomento, '-30', 'i numeri negativi sono argomenti');
    assert.equal(leggiArgomenti([]).comando, 'aiuto');
    assert.equal(leggiArgomenti(['--help']).comando, 'aiuto');
    assert.throws(() => leggiArgomenti(['stato', '-Volume']), /Opzione sconosciuta: '-Volume'/);
    assert.throws(() => leggiArgomenti(['apri', 'a', 'b']), /Troppi argomenti/);
    assert.throws(() => leggiArgomenti(['stato', '-Archivio']), /Manca la cartella/);
});

test('gli esempi del README, uno dopo l\'altro', () => {
    const base = cartellaTemporanea();
    try {
        // "oblio crea" crea ./archivio-oblio nella cartella corrente
        let r = lancia(['crea'], { cwd: base });
        assert.equal(r.codice, 0);
        assert.match(r.out, /Archivio Oblio creato in .*archivio-oblio/);
        assert.ok(fs.existsSync(path.join(base, 'archivio-oblio', '.oblio', 'stato.json')));

        const cartella = path.join(base, 'cartella');
        scriviFile(cartella, 'diario.txt', DIARIO);
        scriviFile(cartella, 'contratto.txt', 'Il contratto di affitto.');
        r = lancia(['aggiungi', cartella], { cwd: base });
        assert.match(r.out, /2 file affidati all'oblio\./);

        r = lancia(['stato'], { cwd: base });
        assert.match(r.out, /FILE {21}STATO {5}VITALITÀ/);

        r = lancia(['apri', 'diario.txt'], { cwd: base });
        assert.match(r.out, /Fonte: {3}originale, intatto/);
        r = lancia(['cerca', 'mare'], { cwd: base });
        assert.match(r.out, /diario\.txt .*trovato/);
        r = lancia(['libera', 'contratto.txt'], { cwd: base });
        assert.match(r.out, /torna a seguire il corso dell'oblio/);
        r = lancia(['fissa', 'contratto.txt'], { cwd: base });
        assert.match(r.out, /ora è indimenticabile/);
        r = lancia(['dimentica', 'diario.txt'], { cwd: base });
        assert.match(r.out, /-Conferma/);
        r = lancia(['dimentica', 'diario.txt', '-Conferma'], { cwd: base });
        assert.match(r.out, /è stato dimenticato per sempre/);
        r = lancia(['velocita', 'elefante'], { cwd: base });
        assert.match(r.out, /▶ elefante {5}nitido ~499 gg · sbiadito fino a ~1159 gg · essenza fino a ~2157 gg, poi traccia/);
        r = lancia(['tempo', '90'], { cwd: base });
        assert.match(r.out, /Il tempo avanza di 90 giorni \(simulazione\)/);
        r = lancia(['tempo', 'reset'], { cwd: base });
        assert.match(r.out, /Orologio riportato a oggi/);
    } finally { pulisci(base); }
});

test('-Archivio, --archivio e la variabile OBLIO_ARCHIVIO', () => {
    const base = cartellaTemporanea();
    try {
        const a = path.join(base, 'uno'), b = path.join(base, 'due'), c = path.join(base, 'tre');
        assert.equal(lancia(['crea', '-Archivio', a]).codice, 0);
        assert.equal(lancia(['crea', `--archivio=${b}`]).codice, 0);
        assert.equal(lancia(['crea'], { env: { OBLIO_ARCHIVIO: c } }).codice, 0);
        for (const p of [a, b, c]) assert.ok(fs.existsSync(path.join(p, '.oblio', 'stato.json')), p);
        // l'opzione vince sulla variabile
        const r = lancia(['stato', '--archivio', a], { env: { OBLIO_ARCHIVIO: c } });
        assert.match(r.out, new RegExp(`OBLIO · ${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    } finally { pulisci(base); }
});

test('errori: stampati come "  Errore: ..." e codice di uscita 1', () => {
    const base = cartellaTemporanea();
    try {
        let r = lancia(['vola'], { cwd: base });
        assert.equal(r.codice, 1);
        assert.equal(r.err, "  Errore: Comando sconosciuto: 'vola'. Scrivi:  oblio aiuto\n");
        r = lancia(['stato'], { cwd: base });
        assert.equal(r.codice, 1);
        assert.match(r.err, /Errore: Nessun archivio Oblio in '.*archivio-oblio'\. Crealo con: {2}oblio crea/);
        r = lancia([], { cwd: base });
        assert.equal(r.codice, 0);
        assert.match(r.out, /OBLIO — il file system che dimentica come un essere umano/);
    } finally { pulisci(base); }
});

test('i colori ANSI compaiono solo nel terminale', () => {
    const r = lancia(['aiuto']);
    assert.ok(!r.out.includes('\x1b['));
});

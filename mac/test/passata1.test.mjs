// Regressioni della prima passata di revisione del nucleo (lib/ e bin/):
// ogni test riproduce un difetto che ora è corretto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatData } from '../lib/formato.js';
import { dataScatto } from '../lib/exif.js';
import { fattore } from '../lib/modello.js';

import { MAC, nuovoArchivio, pulisci, oblio, scriviFile, contesto, cartellaTemporanea } from './aiuto.mjs';

test('aggiungi una cartella che contiene l\'archivio: i ricordi non rientrano anche se il percorso è scritto con accenti NFD o un link', () => {
    const base = fs.realpathSync(cartellaTemporanea('oblio-escludi-'));
    try {
        const nfd = 'città'.normalize('NFD'), nfc = 'città'.normalize('NFC');
        const cartella = path.join(base, nfd);
        scriviFile(cartella, 'a.txt', 'Una nota.');
        const archivio = path.join(cartella, 'arch');
        oblio(archivio, 'crea');
        oblio(archivio, 'aggiungi', path.join(base, nfc, 'a.txt'));
        oblio(archivio, 'apri', 'a.txt');   // ora in arch/ricordi c'è a.txt
        assert.ok(fs.existsSync(path.join(archivio, 'ricordi', 'a.txt')));
        // stessa cartella, accenti nell'altra forma
        oblio(archivio, 'aggiungi', path.join(base, nfc));
        // stessa cartella, attraverso un collegamento simbolico
        fs.symlinkSync(cartella, path.join(base, 'collegamento'));
        oblio(archivio, 'aggiungi', path.join(base, 'collegamento'));
        assert.deepEqual(contesto(archivio).stato.voci.map(v => v.nome), ['a.txt', 'a (2).txt', 'a (3).txt'],
            'solo a.txt della cartella, mai la copia in ricordi');
    } finally { pulisci(base); }
});

// Un ciclo infinito sincrono non si ferma con il timeout di node:test: lo si prova in un processo a parte.
function estraiInProcesso(codice) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', codice], { encoding: 'utf8', timeout: 15000, cwd: MAC });
    assert.equal(r.signal, null, 'l\'estrazione non deve bloccarsi');
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

test('PDF troncato a metà di una stringa esadecimale: aggiungi non si blocca più', () => {
    const risultato = estraiInProcesso(`
        import { estraiTesto } from './lib/estrai.mjs';
        const c = 'BT /F1 12 Tf (Questo documento parla del mare e della montagna) Tj <4142';
        const pdf = '%PDF-1.4\\n1 0 obj << /Type /Page /Contents 2 0 R >> endobj\\n2 0 obj << /Length ' + c.length + ' >>\\nstream\\n' + c + '\\nendstream\\nendobj\\n';
        console.log(JSON.stringify(estraiTesto(Buffer.from(pdf, 'latin1'), '.pdf')));`);
    assert.equal(risultato, 'Questo documento parla del mare e della montagna');
});

test('PDF con /ObjStm e un /N enorme: nessun ciclo da miliardi di giri', () => {
    const risultato = estraiInProcesso(`
        import { deflateSync } from 'node:zlib';
        import { estraiTesto } from './lib/estrai.mjs';
        const corpo = deflateSync(Buffer.from('3 0 << /Type /Page >>'));
        const pdf = Buffer.concat([Buffer.from('%PDF-1.5\\n1 0 obj << /Type /ObjStm /N 2000000000 /First 4 /Filter /FlateDecode /Length ' + corpo.length + ' >>\\nstream\\n', 'latin1'), corpo, Buffer.from('\\nendstream\\nendobj\\n')]);
        console.log(JSON.stringify(estraiTesto(pdf, '.pdf')));`);
    assert.equal(risultato, null);
});

test('file oltre i 2 GB: messaggio in italiano come su Windows, non quello inglese di Node', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const p = path.join(base, 'enorme.bin');
        fs.writeFileSync(p, '');
        fs.truncateSync(p, 2 ** 31 + 10);   // file sparso: non occupa davvero 2 GB
        const r = oblio(archivio, 'aggiungi', p);
        assert.match(r.testo, /^ {2}! enorme\.bin: Il file è troppo lungo\. Questa operazione è attualmente limitata al supporto di file di dimensioni inferiori a 2 GB\.$/m);
        assert.match(r.testo, /0 file affidati all'oblio\./);
        assert.equal(contesto(archivio).stato.voci.length, 0);
    } finally { pulisci(base); }
});

test('orologio simulato molto indietro: l\'anno ha sempre quattro cifre, come "yyyy" di .NET', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const r = oblio(archivio, 'tempo', '-700000', { ora: () => Date.UTC(2026, 9, 4, 12) });
        assert.match(r.testo, /Oggi è il 23 mar 0110\./);
        assert.equal(formatData(new Date(2026, 9, 4)), '4 ott 2026');
    } finally { pulisci(base); }
});

test('errori del disco in italiano: file illeggibile in aggiungi, archivio dentro un file in crea', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const p = scriviFile(base, 'bloccato.bin', 'segreto');
        fs.chmodSync(p, 0o000);
        try {
            const r = oblio(archivio, 'aggiungi', p);
            assert.match(r.testo, new RegExp(`^ {2}! bloccato\\.bin: Accesso al percorso '${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' negato\\.$`, 'm'));
            assert.ok(!/EACCES|permission denied/.test(r.testo), r.testo);
        } finally { fs.chmodSync(p, 0o644); }

        const cli = spawnSync(process.execPath, [path.join(MAC, 'bin', 'oblio.mjs'), 'crea', '-Archivio', path.join(p, 'arch')],
            { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
        assert.equal(cli.status, 1);
        assert.match(cli.stderr, /^ {2}Errore: Impossibile trovare una parte del percorso '.*bloccato\.bin.*'\.\n$/);
        assert.ok(!/ENOTDIR|\n\s+at /.test(cli.stderr), cli.stderr);
    } finally { pulisci(base); }
});

test('stato.json rovinato: errore in italiano che dice quale file, non il messaggio di JSON.parse o di JavaScript', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const p = path.join(archivio, '.oblio', 'stato.json');
        for (const contenuto of ['{rotto', '', 'null', '[1]', '"testo"']) {
            fs.writeFileSync(p, contenuto);
            const cli = spawnSync(process.execPath, [path.join(MAC, 'bin', 'oblio.mjs'), 'stato', '-Archivio', archivio],
                { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
            assert.equal(cli.status, 1, contenuto);
            assert.match(cli.stderr, /^ {2}Errore: Il file '.*stato\.json' è rovinato: non (è JSON valido|contiene lo stato di un archivio)\.\n$/, contenuto);
        }
    } finally { pulisci(base); }
});

// Un JPEG ridotto all'osso con solo la data di scatto EXIF (tag 0x9003).
function jpegConData(s) {
    const testo = Buffer.from(s + '\0', 'latin1');
    const tiff = Buffer.alloc(26);
    tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x9003, 10); tiff.writeUInt16BE(2, 12);
    tiff.writeUInt32BE(testo.length, 14); tiff.writeUInt32BE(26, 18); tiff.writeUInt32BE(0, 22);
    const corpo = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, testo]);
    const app1 = Buffer.from([0xff, 0xe1, 0, 0]); app1.writeUInt16BE(corpo.length + 2, 2);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, corpo, Buffer.from([0xff, 0xd9])]);
}

test('data di scatto EXIF impossibile ("0000:00:00 00:00:00", 30 febbraio...): si usa la data del file, come ParseExact', () => {
    assert.equal(formatData(dataScatto(jpegConData('2025:07:14 10:20:30'))), '14 lug 2025');
    for (const s of ['0000:00:00 00:00:00', '2026:13:45 10:00:00', '2026:02:30 10:00:00', '2026:01:01 24:00:00']) {
        assert.equal(dataScatto(jpegConData(s)), null, s);
    }
    assert.equal(formatData(dataScatto(jpegConData('0099:01:01 12:00:00'))), '1 gen 0099', 'l\'anno 99 non diventa 1999');
});

test('apri -Mostra senza il comando "open" raggiungibile: nessuna pila di Node, codice 0', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'n.txt', 'Una nota.'));
        const r = spawnSync(process.execPath, [path.join(MAC, 'bin', 'oblio.mjs'), 'apri', 'n.txt', '-Mostra', '-Archivio', archivio],
            { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', PATH: path.join(base, 'vuota') } });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stderr, '');
        assert.match(r.stdout, /Aperto: {2}n\.txt/);
    } finally { pulisci(base); }
});

test('stato: i nomi che differiscono solo per un accento si ordinano come Sort-Object ("papa" prima di "papà")', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(path.join(base, 'a'), 'papà.txt', 'Una nota.'));
        oblio(archivio, 'aggiungi', scriviFile(path.join(base, 'b'), 'papa.txt', 'Una nota.'));
        oblio(archivio, 'aggiungi', scriviFile(path.join(base, 'c'), 'Ape.txt', 'Una nota.'));
        const righe = oblio(archivio, 'stato').testo.split('\n').filter(r => /\.txt +nitido/.test(r)).map(r => r.trim().split(/ +/)[0]);
        assert.deepEqual(righe, ['Ape.txt', 'papa.txt', 'papà.txt']);
    } finally { pulisci(base); }
});

test('velocita scritta con le maiuscole in stato.json ("Elefante"): vale come su Windows, dove il dizionario ignora le maiuscole', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const p = path.join(archivio, '.oblio', 'stato.json');
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        s.velocita = 'Elefante';
        fs.writeFileSync(p, JSON.stringify(s));
        assert.equal(fattore({ velocita: 'Elefante' }), 4);
        assert.equal(fattore({ velocita: 'PESCE-ROSSO' }), 0.25);
        assert.match(oblio(archivio, 'velocita').testo, /▶ elefante/);
    } finally { pulisci(base); }
});

test('aggiungi una cartella con collegamenti simbolici a file: vengono affidati come su Windows (Get-ChildItem -File), i link rotti e alle cartelle no', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const vero = scriviFile(path.join(base, 'altrove'), 'vero.txt', 'Il contenuto vero.');
        const cartella = path.join(base, 'foto');
        scriviFile(cartella, 'nota.txt', 'Una nota.');
        fs.symlinkSync(vero, path.join(cartella, 'link.txt'));
        fs.symlinkSync(path.join(base, 'non-esiste.txt'), path.join(cartella, 'rotto.txt'));
        fs.symlinkSync(path.join(base, 'altrove'), path.join(cartella, 'cartella-link'));
        const r = oblio(archivio, 'aggiungi', cartella);
        assert.match(r.testo, /2 file affidati all'oblio\./);
        assert.deepEqual(contesto(archivio).stato.voci.map(v => v.nome), ['link.txt', 'nota.txt']);
        assert.match(oblio(archivio, 'cerca', 'contenuto vero').testo, /link\.txt/);
    } finally { pulisci(base); }
});

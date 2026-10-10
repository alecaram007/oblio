// Compatibilità: l'archivio creato dalla demo Windows (oblio/demo/archivio) si legge
// e si usa senza problemi. Si lavora sempre su una copia temporanea.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { copiaDemoWindows, pulisci, oblio, contesto, DEMO_WINDOWS } from './aiuto.mjs';
import { leggiStrato, salva, istantanea } from '../lib/archivio.mjs';
import { stratiVivi, statoVoce } from '../lib/modello.js';
import { decodifica, sipsDisponibile } from '../lib/sips.mjs';

const ATTESI = {
    'appunti-trasloco.txt': 'essenza',
    'backup-vecchio.bin': 'traccia',
    'bosco.jpg': 'essenza',
    'diario-estate.txt': 'sbiadito',
    'fattura-luce-settembre.txt': 'nitido',
    'mare.jpg': 'sbiadito',
    'tramonto.png': 'sbiadito',
};

test('legge stato.json e chiavi.json scritti da PowerShell (CRLF, indentazione, date a 7 cifre)', () => {
    const { base, archivio } = copiaDemoWindows();
    try {
        const ctx = contesto(archivio);
        assert.equal(ctx.stato.versione, 1);
        assert.equal(ctx.stato.offsetGiorni, 515);
        assert.equal(ctx.stato.voci.length, 7);
        assert.equal(ctx.chiavi.size, 11);
        for (const v of ctx.stato.voci) assert.equal(statoVoce(v), ATTESI[v.nome], v.nome);
        const fattura = ctx.stato.voci.find(v => v.nome === 'fattura-luce-settembre.txt');
        assert.equal(fattura.fissato, true);
        assert.equal(fattura.motivoFissato, 'valore legale (nome)');
        // ogni strato vivo si decifra con la sua chiave
        for (const v of ctx.stato.voci) {
            for (const s of stratiVivi(v)) assert.ok(leggiStrato(ctx, v, s).length > 0, `${v.nome}/${s.nome}`);
        }
    } finally { pulisci(base); }
});

test('oblio stato sull\'archivio Windows: stessi stati, stesse descrizioni', () => {
    const { base, archivio } = copiaDemoWindows();
    try {
        const { testo } = oblio(archivio, 'stato');
        assert.match(testo, /\(tempo simulato: \+515 giorni\) · velocità dell'oblio: normale/);
        assert.match(testo, /^ {2}nitidi {6}1 {2}█+$/m);
        assert.match(testo, /^ {2}sbiaditi {4}3 {2}█{20}$/m);
        assert.match(testo, /^ {2}essenze {5}2 {2}█+$/m);
        assert.match(testo, /^ {2}tracce {6}1 {2}█+$/m);
        assert.match(testo, /^ {2}fissati {5}1 {2}\(indimenticabili\)$/m);
        assert.match(testo, /^ {2}fattura-luce-settembre\.… nitido {4}fissato {9}originale · 26 parole {7}mai$/m);
        assert.match(testo, /^ {2}backup-vecchio\.bin {7}traccia {3}░░░░░░░░░░ — {4}solo la descrizione {9}—$/m);
        assert.match(testo, /^ {2}mare\.jpg {17}sbiadito {2}█+░+ 0,\d\d media · 480×320 px/m);
    } finally { pulisci(base); }
});

test('apri, cerca e salva sull\'archivio Windows', { skip: !sipsDisponibile() && 'sips non disponibile' }, () => {
    const { base, archivio } = copiaDemoWindows();
    try {
        let r = oblio(archivio, 'apri', 'mare.jpg');
        assert.match(r.testo, /Fonte: {3}ricostruito dallo strato «media» \(480×320 px\)/);
        const img = decodifica(fs.readFileSync(path.join(archivio, 'ricordi', 'mare.ricordo.jpg')));
        assert.deepEqual([img.larghezza, img.altezza], [2400, 1600]);

        r = oblio(archivio, 'apri', 'diario');
        assert.match(r.testo, /ricostruito dallo strato «riassunto» \(4 frasi su 12\)/);
        const ricordo = fs.readFileSync(path.join(archivio, 'ricordi', 'diario-estate.ricordo.txt'), 'utf8');
        assert.equal(ricordo, fs.readFileSync(path.join(DEMO_WINDOWS, 'ricordi', 'diario-estate.ricordo.txt'), 'utf8'),
            'stesso identico file prodotto dalla versione Windows');

        r = oblio(archivio, 'apri', 'backup');
        assert.match(r.testo, /solo la traccia: il contenuto è dimenticato/);
        const traccia = fs.readFileSync(path.join(archivio, 'ricordi', 'backup-vecchio.traccia.txt'), 'utf8');
        const tracciaWin = fs.readFileSync(path.join(DEMO_WINDOWS, 'ricordi', 'backup-vecchio.traccia.txt'), 'utf8');
        // identica, a parte la data "Affidato a Oblio il" che dipende dal fuso orario
        assert.equal(traccia.replace(/il \d+ \w+ \d{4}/, ''), tracciaWin.replace(/il \d+ \w+ \d{4}/, ''));

        r = oblio(archivio, 'cerca', 'mare');
        assert.match(r.testo, /diario-estate\.txt {8}sbiadito {2}trovato nella traccia, nel testo \(riassunto\)/);
        assert.match(r.testo, /mare\.jpg {17}sbiadito {2}trovato nel nome/);

        // dopo il salvataggio il JSON resta compatibile: stessi campi, stesse voci
        const prima = JSON.parse(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'stato.json'), 'utf8'));
        const dopo = JSON.parse(fs.readFileSync(path.join(archivio, '.oblio', 'stato.json'), 'utf8'));
        assert.deepEqual(Object.keys(dopo), Object.keys(prima));
        assert.deepEqual(Object.keys(dopo.voci[0]), Object.keys(prima.voci[0]));
        assert.deepEqual(Object.keys(dopo.voci[0].strati[0]), Object.keys(prima.voci[0].strati[0]));
        assert.deepEqual(dopo.voci.map(v => v.id), prima.voci.map(v => v.id));
        const chiavi = JSON.parse(fs.readFileSync(path.join(archivio, '.oblio', 'chiavi.json'), 'utf8'));
        assert.deepEqual(Object.keys(chiavi), [...Object.keys(chiavi)].sort());
    } finally { pulisci(base); }
});

test('un array di una sola voce scritto come oggetto (stile PowerShell) si legge lo stesso', () => {
    const { base, archivio } = copiaDemoWindows();
    try {
        const p = path.join(archivio, '.oblio', 'stato.json');
        const stato = JSON.parse(fs.readFileSync(p, 'utf8'));
        const binario = stato.voci.find(v => v.tipo === 'binario');
        binario.strati = binario.strati[0];
        stato.voci = binario;
        delete stato.dimenticatiPerSempre;
        fs.writeFileSync(p, '﻿' + JSON.stringify(stato, null, 2).replace(/\n/g, '\r\n'));
        const ctx = contesto(archivio);
        assert.equal(ctx.stato.voci.length, 1);
        assert.equal(ctx.stato.voci[0].strati.length, 1);
        assert.equal(ctx.stato.dimenticatiPerSempre, 0);
        salva(ctx);
        assert.ok(Array.isArray(JSON.parse(fs.readFileSync(p, 'utf8')).voci));
        assert.equal(istantanea(ctx).voci[0].stato, 'traccia');
    } finally { pulisci(base); }
});

test('l\'archivio Windows originale non viene mai toccato dai test', () => {
    const dati = JSON.parse(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'stato.json'), 'utf8'));
    assert.equal(dati.offsetGiorni, 515);
    assert.ok(!fs.existsSync(path.join(DEMO_WINDOWS, 'ricordi', 'mare.jpg')));
});

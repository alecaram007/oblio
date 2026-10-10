// Riassunto estrattivo e riconoscimento dei documenti da fissare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { analisiTesto, testoEssenza, leggiTesto, motivoFissato, STOP } from '../lib/testo.js';
import { sproteggiStrato } from '../lib/cifra.mjs';
import { TESTI } from '../lib/demo.mjs';
import { DEMO_WINDOWS } from './aiuto.mjs';

const chiaviWindows = () => JSON.parse(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'chiavi.json'), 'utf8'));
const stratoWindows = id => sproteggiStrato(
    fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'strati', `${id}.bin`)),
    Buffer.from(chiaviWindows()[id], 'base64')).toString('utf8');

test('riassunto ed essenza identici a quelli calcolati dalla versione Windows', () => {
    // diario-estate.txt (cc6207884c) e fattura (b9c37cbf26) nella demo Windows
    const diario = analisiTesto(TESTI['diario-estate.txt']);
    assert.equal(diario.parole, 174);
    assert.equal(diario.frasi, 12);
    assert.equal(diario.frasiRiassunto, 4);
    assert.deepEqual(diario.chiave, ['mare', 'nonna', 'sera', 'agosto', 'anno', 'arrivati']);
    assert.equal(diario.riassunto, stratoWindows('cc6207884c/riassunto'));
    assert.equal(testoEssenza(diario), stratoWindows('cc6207884c/essenza'));

    const fattura = analisiTesto(TESTI['fattura-luce-settembre.txt']);
    assert.equal(fattura.riassunto, stratoWindows('b9c37cbf26/riassunto'));
    assert.equal(testoEssenza(fattura), stratoWindows('b9c37cbf26/essenza'));
    assert.equal(stratoWindows('b9c37cbf26/originale'), TESTI['fattura-luce-settembre.txt']);

    const appunti = analisiTesto(TESTI['appunti-trasloco.txt']);
    assert.equal(testoEssenza(appunti), stratoWindows('ea033592c6/essenza'));
    assert.equal(Buffer.byteLength(appunti.riassunto), 215);   // "riassunto (3 frasi su 7, 215 B)" nella demo Windows
    assert.equal(appunti.frasiRiassunto, 3);
});

test('il riassunto è estrattivo: circa il 30% delle frasi, nell\'ordine originale', () => {
    const frasi = Array.from({ length: 20 }, (_, i) => `Frase numero ${i} sul tema giardino e sulle rose numero ${i}.`);
    frasi[7] = 'Il giardino delle rose rosse è il giardino più bello del paese delle rose.';
    const a = analisiTesto(frasi.join(' '));
    assert.equal(a.frasi, 20);
    assert.equal(a.frasiRiassunto, 6);
    // ogni frase del riassunto esiste parola per parola nel testo, e l'ordine è conservato
    const scelte = a.riassunto.split(/(?<=\.)\s+/);
    let ultimo = -1;
    for (const f of scelte) {
        const i = frasi.indexOf(f);
        assert.ok(i > ultimo, `"${f}" fuori ordine o inventata`);
        ultimo = i;
    }
    assert.ok(scelte.includes(a.essenza), 'l\'essenza è la frase migliore, quindi è anche nel riassunto');
    assert.ok(frasi.includes(a.essenza));
    assert.ok(a.chiave.includes('giardino') && a.chiave.includes('rose'));
    // massimo 12 frasi
    assert.equal(analisiTesto(Array.from({ length: 100 }, (_, i) => `Riga ${i} di prova.`).join('\n')).frasiRiassunto, 12);
});

test('parole vuote, numeri e parole corte non diventano parole chiave', () => {
    const a = analisiTesto('Il 2026 è un anno. Il 2026 è un anno con il sole. Il sole e il mare.');
    assert.ok(!a.chiave.includes('2026'));
    assert.ok(!a.chiave.includes('il'));
    assert.ok(a.chiave.includes('sole'));
    assert.ok(STOP.has('perché') && STOP.has('the'));
    assert.deepEqual(analisiTesto(''), { parole: 0, frasi: 0, chiave: [], riassunto: '', frasiRiassunto: 0, essenza: '' });
});

test('lettura del testo: UTF-8 con o senza BOM, altrimenti cp1252', () => {
    assert.equal(leggiTesto(Buffer.from('﻿ciao è', 'utf8')), 'ciao è');
    assert.equal(leggiTesto(Buffer.from([0x63, 0x61, 0x66, 0xe8])), 'cafè');
    assert.equal(leggiTesto(Buffer.from([0x80, 0x20, 0x35])), '€ 5');
});

test('fissaggio automatico: dal nome del file', () => {
    for (const nome of ['fattura-luce-settembre', 'Fattura 2026', 'scontrino', 'ricevuta_affitto', 'contratto lavoro', 'garanzia-frigo',
        'bolletta gas', 'rogito casa', 'polizza auto', 'cedolino marzo', 'busta paga', 'bustapaga', 'busta-paga-2026',
        'F24 giugno', 'modello_730', '730', 'cud 2025', 'CUD']) {
        assert.equal(motivoFissato(nome, ''), 'valore legale (nome)', nome);
    }
    for (const nome of ['vacanze', 'f245', 'x7301', 'cudine', 'foto-1730', 'mare']) {
        assert.equal(motivoFissato(nome, ''), '', nome);
    }
});

test('fissaggio automatico: dal contenuto', () => {
    for (const testo of ['Fattura n. 12 del 3 marzo', 'FATTURA NR 7', 'Partita IVA 01234567890', 'P. IVA 0123', 'p.iva 0123',
        'IBAN IT60X0542811101000000123456', 'Totale da pagare: 64,80 euro', 'codice fiscale RSSMRA80A01H501U']) {
        assert.equal(motivoFissato('documento', testo), 'valore legale (contenuto)', testo);
    }
    for (const testo of ['Una giornata al mare', 'libano e tibano', 'il totale è 5', 'la fatturazione elettronica']) {
        assert.equal(motivoFissato('documento', testo), '', testo);
    }
    // il nome ha la precedenza sul contenuto
    assert.equal(motivoFissato('fattura', 'IBAN IT00'), 'valore legale (nome)');
});

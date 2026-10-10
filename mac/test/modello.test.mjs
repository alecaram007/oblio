// La curva dell'oblio, le soglie degli strati e la formattazione all'italiana.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    STABILITA_BASE, VELOCITA, tabellaVelocita, vitalita, statoVoce, stratiVivi,
    giorniAlProssimo, anteprimaDomani, oggi, fattore,
} from '../lib/modello.js';
import {
    formatByte, formatData, formatNome, numero, decimali2, arrotondaPari, isoOra, leggiData, GIORNO_MS,
} from '../lib/formato.js';
import { OBLIO } from './aiuto.mjs';

const STRATI_IMMAGINE = () => [
    { nome: 'miniatura', soglia: 0.05, vivo: true },
    { nome: 'media', soglia: 0.2, vivo: true },
    { nome: 'originale', soglia: 0.5, vivo: true },
];

function voceA(giorniFa, stabilita = STABILITA_BASE, adesso = new Date('2027-01-01T12:00:00Z')) {
    return {
        id: 'x', nome: 'x.jpg', stabilita, fissato: false,
        ultimoAccesso: new Date(adesso.getTime() - giorniFa * GIORNO_MS).toISOString(),
        strati: STRATI_IMMAGINE(),
    };
}

// La tabella "Ecco quanto dura ogni stato" del README originale.
function tabellaReadme() {
    const readme = fs.readFileSync(path.join(OBLIO, 'README.md'), 'utf8');
    const righe = {};
    for (const m of readme.matchAll(/^\| (pesce-rosso|normale|elefante) \| ~(\d+) giorni \| ~(\d+) (giorni|anni) \| ~(\d+) (giorni|anni) \|$/gm)) {
        righe[m[1]] = { nitido: +m[2], sbiadito: [+m[3], m[4]], essenza: [+m[5], m[6]] };
    }
    return righe;
}

test('le tre velocità coincidono con la tabella del README', () => {
    const readme = tabellaReadme();
    assert.deepEqual(Object.keys(readme).sort(), ['elefante', 'normale', 'pesce-rosso']);
    const inUnita = ([n, unita], giorni) => (unita === 'anni' ? Math.round(giorni / 365) === n : giorni === n);
    for (const t of tabellaVelocita()) {
        const r = readme[t.nome];
        assert.equal(t.nitido, r.nitido, `${t.nome}: nitido`);
        assert.ok(inUnita(r.sbiadito, t.sbiadito), `${t.nome}: sbiadito ${t.sbiadito} gg contro ${r.sbiadito.join(' ')}`);
        assert.ok(inUnita(r.essenza, t.essenza), `${t.nome}: essenza ${t.essenza} gg contro ${r.essenza.join(' ')}`);
    }
    assert.deepEqual(tabellaVelocita().map(t => [t.nome, t.nitido, t.sbiadito, t.essenza]), [
        ['elefante', 499, 1159, 2157],
        ['normale', 125, 290, 539],
        ['pesce-rosso', 31, 72, 135],
    ]);
});

test('la vitalità segue R = e^(-t/S) e le soglie decidono lo stato', () => {
    const adesso = new Date('2027-01-01T12:00:00Z');
    for (const [nome, f] of Object.entries(VELOCITA)) {
        const t = tabellaVelocita().find(x => x.nome === nome);
        const S = STABILITA_BASE;
        // appena prima e appena dopo ogni soglia
        for (const [giorno, soglia] of [[t.nitido, 0.5], [t.sbiadito, 0.2], [t.essenza, 0.05]]) {
            const prima = vitalita(voceA(giorno - 1, S, adesso), adesso, f);
            const dopo = vitalita(voceA(giorno + 1, S, adesso), adesso, f);
            assert.ok(prima > soglia, `${nome} giorno ${giorno - 1}: ${prima} > ${soglia}`);
            assert.ok(dopo < soglia, `${nome} giorno ${giorno + 1}: ${dopo} < ${soglia}`);
        }
    }
    const v = voceA(180, 180, adesso);
    assert.ok(Math.abs(vitalita(v, adesso, 1) - Math.exp(-1)) < 1e-9);
    // un ultimo accesso nel futuro vale come "adesso"
    assert.equal(vitalita(voceA(-10, 180, adesso), adesso, 1), 1);
});

test('stato della voce: nitido, sbiadito, essenza, traccia', () => {
    const v = voceA(0);
    assert.equal(statoVoce(v), 'nitido');
    v.strati[2].vivo = false;
    assert.equal(statoVoce(v), 'sbiadito');
    v.strati[1].vivo = false;
    assert.equal(statoVoce(v), 'essenza');
    v.strati[0].vivo = false;
    assert.equal(statoVoce(v), 'traccia');
    // un binario ha solo l'originale (soglia 0,2): è nitido finché c'è
    assert.equal(statoVoce({ strati: [{ nome: 'originale', soglia: 0.2, vivo: true }] }), 'nitido');
    assert.deepEqual(stratiVivi(voceA(0)).map(s => s.nome), ['originale', 'media', 'miniatura']);
});

test('giorni al prossimo oblio', () => {
    const adesso = new Date('2027-01-01T12:00:00Z');
    assert.equal(giorniAlProssimo(voceA(0, 180, adesso), adesso, 1), 125);
    assert.equal(giorniAlProssimo(voceA(100, 180, adesso), adesso, 1), 25);
    assert.equal(giorniAlProssimo(voceA(130, 180, adesso), adesso, 1), 0);
    const fissata = { ...voceA(0, 180, adesso), fissato: true };
    assert.equal(giorniAlProssimo(fissata, adesso, 1), null);
    const traccia = voceA(0, 180, adesso);
    for (const s of traccia.strati) s.vivo = false;
    assert.equal(giorniAlProssimo(traccia, adesso, 1), null);
});

test('oggi e fattore leggono offsetGiorni e velocità', () => {
    const ora = Date.UTC(2026, 9, 4, 12);
    assert.equal(oggi({ offsetGiorni: 10 }, ora).getTime(), ora + 10 * GIORNO_MS);
    assert.equal(fattore({ velocita: 'elefante' }), 4);
    assert.equal(fattore({ velocita: 'pesce-rosso' }), 0.25);
    assert.equal(fattore({ velocita: 'sconosciuta' }), 1);
});

test('novità: anteprima del "domani" (cosa sbiadirà nei prossimi giorni)', () => {
    const ora = Date.UTC(2027, 0, 1, 12);
    const adesso = new Date(ora);
    const stato = {
        offsetGiorni: 0, velocita: 'normale',
        voci: [
            { ...voceA(110, 180, adesso), id: 'a', nome: 'a.jpg' },   // perde l'originale tra 15 giorni
            { ...voceA(0, 180, adesso), id: 'b', nome: 'b.jpg' },     // nulla nei prossimi 30
            { ...voceA(110, 180, adesso), id: 'c', nome: 'c.jpg', fissato: true },
        ],
    };
    const p = anteprimaDomani(stato, 30, ora);
    assert.equal(p.length, 1);
    assert.deepEqual({ nome: p[0].nome, strato: p[0].strato, traGiorni: p[0].traGiorni, diventa: p[0].diventa },
        { nome: 'a.jpg', strato: 'originale', traGiorni: 15, diventa: 'sbiadito' });
    assert.equal(anteprimaDomani(stato, 400, ora).filter(x => x.nome === 'a.jpg').length, 2);
    assert.equal(anteprimaDomani(stato, 1000, ora).filter(x => x.nome === 'a.jpg').length, 3);
    assert.equal(anteprimaDomani(stato, 1000, ora).at(-1).diventa, 'traccia');
});

test('formattazione all\'italiana, come la versione Windows', () => {
    assert.equal(formatByte(447), '447 B');
    assert.equal(formatByte(1024), '1 KB');
    assert.equal(formatByte(19613), '19 KB');
    assert.equal(formatByte(1572864), '1,5 MB');
    assert.equal(formatByte(2414627), '2,3 MB');
    assert.equal(formatByte(5 * 1024 ** 3), '5.120,0 MB');
    assert.equal(numero(1125), '1.125');
    assert.equal(numero(-97.4), '-97');
    assert.equal(numero(2.5), '3');
    assert.equal(decimali2(0.435), '0,44');
    assert.equal(decimali2(1), '1,00');
    assert.equal(arrotondaPari(2.5), 2);
    assert.equal(arrotondaPari(3.5), 4);
    assert.equal(arrotondaPari(-2.5), -2);
    assert.equal(arrotondaPari(42.67), 43);
    assert.equal(formatData(new Date(2026, 7, 12, 18, 30)), '12 ago 2026');
    assert.equal(formatData(new Date(2026, 8, 2)), '2 set 2026');
    assert.equal(formatData(new Date(2023, 4, 4)), '4 mag 2023');
    assert.equal(formatNome('fattura-luce-settembre.txt'), 'fattura-luce-settembre.…');
    assert.equal(formatNome('mare.jpg'), 'mare.jpg');
    assert.match(isoOra(new Date('2026-09-30T22:21:22.711Z')), /^2026-09-30T22:21:22\.7110000Z$/);
    assert.equal(leggiData('2026-09-30T22:21:22.1110559Z').toISOString(), '2026-09-30T22:21:22.111Z');
});

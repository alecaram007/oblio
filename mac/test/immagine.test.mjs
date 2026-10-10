// Immagini in JavaScript puro (BMP, ridimensionamento, colori, fascia) e il ponte con sips.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    nuovaImmagine, leggiBMP, scriviBMP, ridimensiona, lato, nomeColore, hsl,
    analisiColori, descrizioneImmagine, aggiungiFiligrana,
} from '../lib/immagine.js';
import { misuraTesto, disegnaTesto } from '../lib/font.js';
import { decodifica, codificaJpeg, codificaPng, formatoImmagine, sipsDisponibile } from '../lib/sips.mjs';
import { dataScatto } from '../lib/exif.js';
import { CasualeNet } from '../lib/casuale.js';

function riempi(img, fn) {
    for (let y = 0; y < img.altezza; y++) {
        for (let x = 0; x < img.larghezza; x++) {
            const o = (y * img.larghezza + x) * 4;
            const [r, g, b, a = 255] = fn(x, y);
            img.dati[o] = r; img.dati[o + 1] = g; img.dati[o + 2] = b; img.dati[o + 3] = a;
        }
    }
    return img;
}
const pixel = (img, x, y) => { const o = (y * img.larghezza + x) * 4; return [...img.dati.subarray(o, o + 4)]; };

test('BMP: scrittura e lettura a 24 bit e a 32 bit con trasparenza', () => {
    const img = riempi(nuovaImmagine(7, 5), (x, y) => [x * 30, y * 50, 200]);
    const letto = leggiBMP(scriviBMP(img));
    assert.equal(letto.larghezza, 7);
    assert.equal(letto.altezza, 5);
    assert.deepEqual(letto.dati, img.dati);

    const trasparente = riempi(nuovaImmagine(3, 2), x => (x === 0 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
    const bmp = scriviBMP(trasparente);
    assert.equal(bmp[28], 32);
    const l = leggiBMP(bmp);
    assert.deepEqual(pixel(l, 0, 0), [255, 255, 255, 255], 'il trasparente diventa bianco, come in GDI+');
    assert.deepEqual(pixel(l, 1, 1), [255, 0, 0, 255]);
    assert.throws(() => leggiBMP(Buffer.from('non sono un bmp')), /non è un file BMP/);
});

test('lato: proporzioni e arrotondamento come Get-Lato', () => {
    assert.deepEqual(lato(2400, 1600, 64), [64, 43]);
    assert.deepEqual(lato(2400, 1600, 480), [480, 320]);
    assert.deepEqual(lato(2400, 1600, 24), [24, 16]);
    assert.deepEqual(lato(30, 20, 64), [30, 20]);
    assert.deepEqual(lato(1000, 1, 64), [64, 1]);
});

test('ridimensionamento bicubico: colori pieni restano pieni, le medie sono giuste', () => {
    const rosso = riempi(nuovaImmagine(100, 60), () => [200, 30, 40]);
    const r = ridimensiona(rosso, 17, 9);
    for (let i = 0; i < r.dati.length; i += 4) assert.deepEqual([...r.dati.subarray(i, i + 3)], [200, 30, 40]);
    // scacchiera fine → grigio uniforme quando si rimpicciolisce (antialiasing)
    const scacchi = riempi(nuovaImmagine(200, 200), (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
    const g = ridimensiona(scacchi, 20, 20);
    for (let i = 0; i < g.dati.length; i += 4) assert.ok(Math.abs(g.dati[i] - 127.5) < 6, `pixel ${i / 4}: ${g.dati[i]}`);
    // ingrandire: nessun valore fuori scala e bordi morbidi
    const piccolo = riempi(nuovaImmagine(2, 1), x => (x ? [255, 255, 255] : [0, 0, 0]));
    const grande = ridimensiona(piccolo, 40, 3);
    const riga = Array.from({ length: 40 }, (_, x) => pixel(grande, x, 1)[0]);
    assert.equal(riga[0], 0);
    assert.equal(riga[39], 255);
    assert.ok(riga.some(v => v > 30 && v < 225), 'una sfumatura tra i due pixel');
    for (let x = 1; x < 40; x++) assert.ok(riga[x] >= riga[x - 1] - 1, 'nessun alone');
});

test('nomi dei colori come Get-NomeColore', () => {
    const casi = [
        [[0, 0, 0], 'nero'], [[255, 255, 255], 'bianco'], [[128, 128, 128], 'grigio'], [[240, 236, 236], 'bianco'],
        [[226, 200, 155], 'beige'], [[238, 214, 170], 'arancione'], [[210, 50, 50], 'rosso'], [[100, 20, 30], 'bordeaux'], [[250, 140, 60], 'arancione'],
        [[120, 70, 20], 'marrone'], [[230, 210, 40], 'giallo'], [[40, 140, 50], 'verde'], [[110, 170, 230], 'azzurro'],
        [[30, 40, 160], 'blu'], [[120, 40, 160], 'viola'], [[220, 60, 160], 'rosa'], [[40, 120, 190], 'azzurro'],
    ];
    for (const [rgb, nome] of casi) assert.equal(nomeColore(...rgb), nome, rgb.join(','));
    const { h, s, l } = hsl(255, 0, 0);
    assert.deepEqual([h, s, l], [0, 1, 0.5]);
});

test('descrizione: orientamento, tono e colori dominanti', () => {
    const mare = riempi(nuovaImmagine(300, 200), (x, y) => (y < 120 ? [110, 170, 230] : [226, 200, 155]));
    assert.equal(descrizioneImmagine(mare, new Date(2026, 7, 12)), 'Immagine orizzontale 300×200, luminosa; colori: azzurro, beige · 12 ago 2026');
    const notte = riempi(nuovaImmagine(100, 300), () => [10, 10, 20]);
    assert.match(descrizioneImmagine(notte, new Date(2026, 0, 1)), /^Immagine verticale 100×300, scura; colori: nero · 1 gen 2026$/);
    const quadrata = riempi(nuovaImmagine(100, 100), () => [40, 140, 50]);
    const a = analisiColori(quadrata);
    assert.equal(a.forma, 'quadrata');
    assert.equal(a.tono, 'dai toni medi');
    assert.deepEqual(a.colori, ['verde']);
});

test('la fascia «RICORDO RICOSTRUITO · NON ORIGINALE» si vede davvero', () => {
    const img = riempi(nuovaImmagine(2400, 1600), () => [200, 220, 240]);
    aggiungiFiligrana(img, 'RICORDO RICOSTRUITO · NON ORIGINALE · da 64×43 px');
    const h = 112; // 7% di 1600
    // sopra la fascia l'immagine è intatta
    assert.deepEqual(pixel(img, 5, 1600 - h - 1), [200, 220, 240, 255]);
    // nella fascia, ai bordi, solo il nero al 69%
    assert.deepEqual(pixel(img, 2, 1600 - 3).slice(0, 3), [200, 220, 240].map(c => Math.round(c * (1 - 175 / 255))));
    // e da qualche parte, al centro, il testo bianco
    let bianchi = 0;
    for (let y = 1600 - h; y < 1600; y++) for (let x = 0; x < 2400; x++) if (pixel(img, x, y)[0] > 245) bianchi++;
    assert.ok(bianchi > 5000, `pixel bianchi del testo: ${bianchi}`);
    const m = misuraTesto('RICORDO RICOSTRUITO · NON ORIGINALE · da 64×43 px', h * 0.45);
    assert.ok(m.larghezza < 2400 && m.larghezza > 1000);
    // immagini piccole: la fascia è alta almeno 24 px e il testo non esce
    const piccola = riempi(nuovaImmagine(120, 80), () => [255, 255, 255]);
    aggiungiFiligrana(piccola, 'RICORDO RICOSTRUITO · NON ORIGINALE · da 64×43 px');
    assert.ok(pixel(piccola, 0, 80 - 24)[0] < 100 && pixel(piccola, 0, 80 - 25)[0] === 255);
    // caratteri accentati o sconosciuti non fanno danni
    disegnaTesto(piccola, 'È già così — ✓', 0, 0, 12);
});

test('sips: decodifica e codifica JPEG e PNG', { skip: !sipsDisponibile() && 'sips non disponibile' }, () => {
    const img = riempi(nuovaImmagine(64, 40), (x, y) => [x * 4, y * 6, 128]);
    const jpeg = codificaJpeg(img, 90);
    assert.equal(formatoImmagine(jpeg), 'jpeg');
    const j = decodifica(jpeg);
    assert.equal(j.larghezza, 64);
    assert.equal(j.altezza, 40);
    assert.ok(Math.abs(pixel(j, 32, 20)[0] - 128) < 12);
    const png = codificaPng(img);
    assert.equal(formatoImmagine(png), 'png');
    assert.deepEqual(decodifica(png).dati, img.dati, 'il PNG è senza perdita');
    assert.deepEqual(decodifica(scriviBMP(img)).dati, img.dati, 'il BMP si legge anche senza sips');
    assert.throws(() => decodifica(Buffer.from('questa non è un\'immagine')), /immagine non leggibile/);
});

test('EXIF: la data di scatto ha la precedenza sulla data del file', { skip: !sipsDisponibile() && 'sips non disponibile' }, () => {
    const jpeg = codificaJpeg(nuovaImmagine(8, 8), 80);
    assert.equal(dataScatto(jpeg), null);
    // APP1 Exif minimale, little endian: IFD0 → ExifIFD → DateTimeOriginal
    const data = Buffer.from('2019:07:21 10:15:30\0', 'ascii');
    const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + data.length);
    tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
    tiff.writeUInt32LE(0, 22);
    tiff.writeUInt16LE(1, 26);
    tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(data.length, 32); tiff.writeUInt32LE(44, 36);
    tiff.writeUInt32LE(0, 40);
    data.copy(tiff, 44);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), Buffer.from('Exif\0\0', 'ascii'), tiff]);
    app1.writeUInt16BE(app1.length - 2, 2);
    const conExif = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
    const d = dataScatto(conExif);
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2019, 6, 21, 10, 15]);
    assert.equal(dataScatto(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2])), null, 'EXIF rovinato: nessuna eccezione');
});

test('System.Random di .NET riprodotto fedelmente', () => {
    const r0 = new CasualeNet(0);
    assert.equal(r0.prossimo(), 1559595546);
    assert.equal(r0.prossimo(), 1755192844);
    const r42 = new CasualeNet(42);
    assert.equal(r42.prossimo(), 1434747710);
    const r = new CasualeNet(42);
    for (let i = 0; i < 1000; i++) {
        const v = r.prossimo(-100, 2400);
        assert.ok(v >= -100 && v < 2400);
    }
});

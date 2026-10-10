// Novità: testo estratto da PDF semplici, .docx e .odt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, deflateRawSync } from 'node:zlib';

import { estraiTesto, testoPdf, testoDocx, leggiZip, MAC_ROMAN } from '../lib/estrai.mjs';
import { FIXTURE, nuovoArchivio, pulisci, oblio, voce, scriviFile } from './aiuto.mjs';

const ATTESO = 'Contratto di locazione\nIl canone mensile è di 750 euro, più spese condominiali.\nPartita IVA 01234567890. Firmato a Milano il 3 ottobre.';
const normalizza = s => s.replace(/\n+/g, '\n');

// Un piccolo zip scritto a mano (compressione deflate), per non dipendere da textutil.
function zip(file) {
    const locali = [], centrali = [];
    let pos = 0;
    for (const [nome, contenuto] of Object.entries(file)) {
        const dati = Buffer.from(contenuto, 'utf8');
        const comp = deflateRawSync(dati);
        const n = Buffer.from(nome, 'utf8');
        const loc = Buffer.alloc(30);
        loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 8);
        loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(dati.length, 22); loc.writeUInt16LE(n.length, 26);
        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
        cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(dati.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(pos, 42);
        locali.push(loc, n, comp);
        centrali.push(cen, n);
        pos += 30 + n.length + comp.length;
    }
    const dir = Buffer.concat(centrali);
    const fine = Buffer.alloc(22);
    fine.writeUInt32LE(0x06054b50, 0); fine.writeUInt16LE(Object.keys(file).length, 8); fine.writeUInt16LE(Object.keys(file).length, 10);
    fine.writeUInt32LE(dir.length, 12); fine.writeUInt32LE(pos, 16);
    return Buffer.concat([...locali, dir, fine]);
}

// Un PDF con un font CID (due byte per carattere) e la sua tabella ToUnicode.
function pdfConToUnicode(testo) {
    const codici = [...testo].map((c, i) => i + 1);
    const hex = codici.map(n => n.toString(16).padStart(4, '0')).join('');
    const contenuto = Buffer.from(`BT /F1 12 Tf 72 720 Td <${hex}> Tj ET`);
    const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
${codici.length} beginbfchar
${[...testo].map((c, i) => `<${codici[i].toString(16).padStart(4, '0')}> <${c.charCodeAt(0).toString(16).padStart(4, '0')}>`).join('\n')}
endbfchar endcmap`;
    const z = deflateSync(Buffer.from(cmap));
    const zc = deflateSync(contenuto);
    const parti = [
        '%PDF-1.4\n',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
        '3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n',
    ];
    const buf = [Buffer.from(parti.join(''))];
    buf.push(Buffer.from(`4 0 obj << /Length ${zc.length} /Filter /FlateDecode >> stream\n`), zc, Buffer.from('\nendstream endobj\n'));
    buf.push(Buffer.from('5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /Finto /Encoding /Identity-H /ToUnicode 6 0 R >> endobj\n'));
    buf.push(Buffer.from(`6 0 obj << /Length ${z.length} /Filter /FlateDecode >> stream\n`), z, Buffer.from('\nendstream endobj\n%%EOF\n'));
    return Buffer.concat(buf);
}

test('docx e odt veri (creati con textutil di macOS)', () => {
    assert.equal(normalizza(estraiTesto(fs.readFileSync(path.join(FIXTURE, 'contratto.docx')), '.docx')), ATTESO);
    assert.equal(normalizza(estraiTesto(fs.readFileSync(path.join(FIXTURE, 'contratto.odt')), '.odt')), ATTESO);
});

test('PDF vero creato da macOS (font TrueType con codifica MacRoman)', () => {
    assert.equal(normalizza(estraiTesto(fs.readFileSync(path.join(FIXTURE, 'contratto.pdf')), '.pdf')), ATTESO);
    assert.equal(MAC_ROMAN.length, 128);
});

test('PDF con font CID e tabella ToUnicode', () => {
    assert.equal(testoPdf(pdfConToUnicode('Totale da pagare: 12 €')), 'Totale da pagare: 12 €');
});

test('PDF semplice con stringhe letterali, TJ e caratteri di escape', () => {
    const contenuto = 'BT /F1 11 Tf 50 700 Td (Riga uno \\(prima\\)) Tj 0 -14 Td [(Riga) -250 (due)] TJ T* (perch\\350 no) Tj ET';
    const pdf = Buffer.from(`%PDF-1.3\n1 0 obj << /Type /Page /Contents 2 0 R /Resources << /Font << /F1 3 0 R >> >> >> endobj\n2 0 obj << /Length ${contenuto.length} >> stream\n${contenuto}\nendstream endobj\n3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n%%EOF`, 'latin1');
    assert.equal(testoPdf(pdf), 'Riga uno (prima)\nRiga due\nperchè no');
});

test('docx scritto a mano: paragrafi, tabulazioni ed entità', () => {
    const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Uno &amp; due</w:t></w:r></w:p><w:p><w:r><w:t>Tre</w:t><w:tab/><w:t>quattro &#232;</w:t></w:r></w:p></w:body></w:document>';
    const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml });
    assert.deepEqual(leggiZip(docx).nomi, ['[Content_Types].xml', 'word/document.xml']);
    assert.equal(testoDocx(docx), 'Uno & due\nTre\tquattro è');
});

test('documenti senza testo leggibile restano binari', () => {
    assert.equal(estraiTesto(Buffer.from('%PDF-1.4\n%%EOF'), '.pdf'), null);
    assert.equal(estraiTesto(Buffer.from('non è uno zip'), '.docx'), null);
    assert.equal(estraiTesto(zip({ 'word/document.xml': '<w:p></w:p>' }), '.docx'), null);
    assert.equal(estraiTesto(Buffer.from('ciao'), '.txt'), null);
});

test('un PDF con testo sbiadisce come un testo (e se è un contratto viene fissato)', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const pdf = scriviFile(base, 'locazione.pdf', fs.readFileSync(path.join(FIXTURE, 'contratto.pdf')), new Date(2026, 9, 3));
        const docx = scriviFile(base, 'lettera.docx', zip({ 'word/document.xml': '<w:p><w:t>Cara Anna, ti scrivo dal mare. Qui piove da tre giorni e le giornate sono lunghe.</w:t></w:p>' }));
        const { testo } = oblio(archivio, 'aggiungi', base);
        assert.match(testo, /locazione\.pdf {12}testo {5}3 strati · 16 KB · fissato: valore legale \(contenuto\)/);
        const v = voce(archivio, 'locazione.pdf');
        assert.equal(v.tipo, 'testo');
        assert.match(v.descrizione, /^Documento PDF di 22 parole, 4 frasi; parla di: canone, condominiali, contratto · 3 ott 2026$/);
        const l = voce(archivio, 'lettera.docx');
        assert.equal(l.tipo, 'testo');
        assert.equal(l.fissato, false);
        assert.match(l.descrizione, /^Documento Word di 16 parole, 2 frasi; parla di: anna, cara, giornate · 12 ago 2026$/);
        // la ricerca guarda dentro il PDF originale (testo estratto)
        assert.match(oblio(archivio, 'cerca', 'canone').testo, /locazione\.pdf .*trovato nella traccia, nel testo \(originale\)/);
        assert.match(oblio(archivio, 'cerca', 'piove').testo, /lettera\.docx .*trovato nel testo \(originale\)/);
        // quando sbiadisce, il riassunto è testo semplice
        oblio(archivio, 'tempo', '140');
        const r = oblio(archivio, 'apri', 'lettera.docx');
        assert.match(r.testo, /ricostruito dallo strato «riassunto»/);
        assert.ok(fs.readFileSync(path.join(archivio, 'ricordi', 'lettera.ricordo.txt'), 'utf8').includes('Cara Anna'));
        assert.match(oblio(archivio, 'apri', 'locazione.pdf').testo, /originale, intatto/);
        assert.deepEqual([...fs.readFileSync(path.join(archivio, 'ricordi', 'locazione.pdf')).subarray(0, 5)], [...Buffer.from('%PDF-')]);
    } finally { pulisci(base); }
});

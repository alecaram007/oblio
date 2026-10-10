// Il nucleo: aggiungere, sbiadire, riaprire, cercare, fissare, dimenticare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    nuovoArchivio, pulisci, oblio, oblioErrore, scriviFile, voce, contesto, cartellaTemporanea, DIARIO,
} from './aiuto.mjs';
import { sproteggiStrato } from '../lib/cifra.mjs';
import { nuovaImmagine, scriviBMP, leggiBMP } from '../lib/immagine.js';
import { codificaJpeg, decodifica, sipsDisponibile } from '../lib/sips.mjs';
import { nomeLibero, leggiStato, percorsi, istantanea, anteprima } from '../lib/archivio.mjs';

const conSips = { skip: !sipsDisponibile() && 'sips non disponibile' };

function foto(larghezza = 600, altezza = 400) {
    const img = nuovaImmagine(larghezza, altezza);
    for (let y = 0; y < altezza; y++) {
        for (let x = 0; x < larghezza; x++) {
            const o = (y * larghezza + x) * 4;
            const cielo = y < altezza * 0.6;
            img.dati[o] = cielo ? 110 : 238; img.dati[o + 1] = cielo ? 170 : 214; img.dati[o + 2] = cielo ? 230 : 170;
            if ((x * 7 + y * 3) % 50 < 2) { img.dati[o] = 20; img.dati[o + 1] = 20; img.dati[o + 2] = 20; }
        }
    }
    return img;
}

test('crea: archivio nuovo, e nessun doppione', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const P = percorsi(archivio);
        for (const p of [P.meta, P.strati, P.ricordi, P.stato, P.chiavi]) assert.ok(fs.existsSync(p), p);
        const stato = leggiStato(P);
        assert.deepEqual(
            { versione: stato.versione, offsetGiorni: stato.offsetGiorni, velocita: stato.velocita, dimenticatiPerSempre: stato.dimenticatiPerSempre, voci: stato.voci },
            { versione: 1, offsetGiorni: 0, velocita: 'normale', dimenticatiPerSempre: 0, voci: [] });
        assert.deepEqual(JSON.parse(fs.readFileSync(P.chiavi, 'utf8')), {});
        assert.match(oblio(archivio, 'crea').testo, /^ {2}Esiste già un archivio Oblio in .+\.$/m);
        assert.match(oblio(archivio, 'stato').testo, /L'archivio è vuoto\. Aggiungi qualcosa con: {2}oblio aggiungi <file\|cartella>/);
    } finally { pulisci(base); }
});

test('senza archivio: il messaggio della versione Windows', () => {
    const base = cartellaTemporanea();
    try {
        assert.equal(oblioErrore(path.join(base, 'niente'), 'stato'),
            `Nessun archivio Oblio in '${path.join(base, 'niente')}'. Crealo con:  oblio crea`);
    } finally { pulisci(base); }
});

test('aggiungi un testo: tre strati cifrati, descrizione e copia (o spostamento)', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const sorgente = scriviFile(path.join(base, 'file'), 'diario.txt', DIARIO);
        const { testo } = oblio(archivio, 'aggiungi', sorgente);
        assert.match(testo, /^ {2}\+ diario\.txt {15}testo {5}3 strati · \d+ B$/m);
        assert.match(testo, /1 file affidati all'oblio\./);
        assert.match(testo, /Gli originali sono rimasti dove erano \(usa -Sposta/);
        assert.ok(fs.existsSync(sorgente), 'senza -Sposta l\'originale resta');

        const v = voce(archivio, 'diario.txt');
        assert.equal(v.tipo, 'testo');
        assert.deepEqual(v.strati.map(s => [s.nome, s.soglia, s.vivo]), [['essenza', 0.05, true], ['riassunto', 0.2, true], ['originale', 0.5, true]]);
        assert.match(v.descrizione, /^Testo di \d+ parole, \d+ frasi; parla di: .+ · 12 ago 2026$/);
        assert.equal(v.stabilita, 180);
        assert.equal(v.accessi, 0);
        assert.equal(v.fissato, false);
        assert.equal(v.id.length, 10);

        // gli strati su disco sono cifrati, e si decifrano con la propria chiave
        const ctx = contesto(archivio);
        const blob = fs.readFileSync(path.join(archivio, '.oblio', 'strati', v.id, 'originale.bin'));
        assert.ok(!blob.includes(Buffer.from('nonna')), 'niente testo in chiaro');
        assert.equal(sproteggiStrato(blob, ctx.chiavi.get(`${v.id}/originale`)).toString('utf8'), DIARIO);

        const altro = scriviFile(path.join(base, 'file'), 'diario.txt', 'Un altro diario, diverso.');
        oblio(archivio, 'aggiungi', altro, { sposta: true });
        assert.ok(!fs.existsSync(altro), 'con -Sposta l\'originale sparisce');
        assert.ok(voce(archivio, 'diario (2).txt'), 'nome libero per il doppione');
    } finally { pulisci(base); }
});

test('aggiungi una cartella: ricorsiva, senza file nascosti e senza l\'archivio stesso', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const cartella = path.join(base, 'roba');
        scriviFile(cartella, 'a.txt', 'Primo testo di prova.');
        scriviFile(path.join(cartella, 'sotto'), 'b.md', 'Secondo testo di prova.');
        scriviFile(cartella, '.DS_Store', 'nascosto');
        scriviFile(path.join(cartella, '.nascosta'), 'c.txt', 'nascosto');
        const { testo } = oblio(archivio, 'aggiungi', cartella);
        assert.match(testo, /2 file affidati all'oblio\./);
        assert.deepEqual(contesto(archivio).stato.voci.map(v => v.nome), ['a.txt', 'b.md']);

        // l'archivio dentro la cartella aggiunta non si aggiunge a se stesso
        const dentro = path.join(cartella, 'archivio-interno');
        oblio(dentro, 'crea');
        scriviFile(path.join(dentro, 'ricordi'), 'vecchio.txt', 'non va aggiunto');
        const r = oblio(dentro, 'aggiungi', cartella);
        assert.match(r.testo, /2 file affidati all'oblio\./);

        assert.equal(oblioErrore(archivio, 'aggiungi', path.join(base, 'non-esiste')), `Non trovo '${path.join(base, 'non-esiste')}'.`);
        assert.equal(oblioErrore(archivio, 'aggiungi', ''), 'Indica un file o una cartella:  oblio aggiungi <percorso>');
        fs.mkdirSync(path.join(base, 'vuota'));
        assert.match(oblio(archivio, 'aggiungi', path.join(base, 'vuota')).testo, /Nessun file da aggiungere\./);
    } finally { pulisci(base); }
});

test('aggiungi un\'immagine: miniatura 64 px, media 480 px, originale', conSips, () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const p = scriviFile(base, 'spiaggia.jpg', codificaJpeg(foto(1200, 800), 90));
        const { testo } = oblio(archivio, 'aggiungi', p);
        assert.match(testo, /\+ spiaggia\.jpg {13}immagine {2}3 strati/);
        const v = voce(archivio, 'spiaggia.jpg');
        assert.equal(v.tipo, 'immagine');
        assert.equal(v.larghezza, 1200);
        assert.equal(v.altezza, 800);
        assert.deepEqual(v.strati.map(s => [s.nome, s.soglia, s.dettaglio]),
            [['miniatura', 0.05, '64×43 px'], ['media', 0.2, '480×320 px'], ['originale', 0.5, '1200×800 px']]);
        assert.match(v.descrizione, /^Immagine orizzontale 1200×800, (luminosa|dai toni medi); colori: azzurro, beige · 12 ago 2026$/);
        const ctx = contesto(archivio);
        const media = decodifica(sproteggiStrato(fs.readFileSync(path.join(archivio, '.oblio', 'strati', v.id, 'media.bin')), ctx.chiavi.get(`${v.id}/media`)));
        assert.deepEqual([media.larghezza, media.altezza], [480, 320]);

        // un'immagine finta diventa un file binario
        const finta = scriviFile(base, 'rotta.png', 'non sono un png');
        oblio(archivio, 'aggiungi', finta);
        const r = voce(archivio, 'rotta.png');
        assert.equal(r.tipo, 'binario');
        assert.equal(r.strati.length, 1);
    } finally { pulisci(base); }
});

test('aggiungi un binario: un solo strato (soglia 0,2) e l\'impronta SHA-256', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const p = scriviFile(base, 'backup.bin', Buffer.alloc(3000, 1), new Date(2023, 4, 4));
        const zip = scriviFile(base, 'foto.zip', Buffer.alloc(10, 2));
        const strano = scriviFile(base, 'dati.xyz', Buffer.alloc(10, 3));
        oblio(archivio, 'aggiungi', p);
        oblio(archivio, 'aggiungi', zip);
        oblio(archivio, 'aggiungi', strano);
        const v = voce(archivio, 'backup.bin');
        assert.equal(v.tipo, 'binario');
        assert.deepEqual(v.strati.map(s => [s.nome, s.soglia, s.dettaglio]), [['originale', 0.2, '3 KB']]);
        assert.match(v.descrizione, /^Dati binari di 3 KB · impronta [0-9a-f]{12}… · 4 mag 2023$/);
        assert.match(voce(archivio, 'foto.zip').descrizione, /^Archivio compresso di 10 B/);
        assert.match(voce(archivio, 'dati.xyz').descrizione, /^File \.xyz di 10 B/);
    } finally { pulisci(base); }
});

test('fissaggio automatico all\'arrivo: per nome e per contenuto', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        const a = scriviFile(base, 'fattura-gas.txt', 'Consumo di ottobre.');
        const b = scriviFile(base, 'lettera.txt', 'Gentile cliente, il totale da pagare è di 30 euro. IBAN IT00X.');
        const c = scriviFile(base, 'note.txt', 'Comprare il pane.');
        const d = scriviFile(base, 'F24 giugno.pdf', Buffer.from('%PDF-1.4 senza testo'));
        const { testo } = oblio(archivio, 'aggiungi', base);
        assert.match(testo, /fattura-gas\.txt .* · fissato: valore legale \(nome\)$/m);
        assert.match(testo, /lettera\.txt .* · fissato: valore legale \(contenuto\)$/m);
        assert.equal(voce(archivio, 'note.txt').fissato, false);
        assert.equal(voce(archivio, path.basename(d)).motivoFissato, 'valore legale (nome)');
        assert.equal(voce(archivio, 'fattura-gas.txt').motivoFissato, 'valore legale (nome)');
        void a; void b; void c;
        // un file fissato non sbiadisce mai
        oblio(archivio, 'tempo', '5000');
        assert.equal(voce(archivio, 'fattura-gas.txt').strati.every(s => s.vivo), true);
        assert.equal(voce(archivio, 'note.txt').strati.every(s => !s.vivo), true);
    } finally { pulisci(base); }
});

test('il tempo fa il suo lavoro: originale → riassunto → essenza → traccia', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'diario.txt', DIARIO));
        let r = oblio(archivio, 'tempo', '100');
        assert.match(r.testo, /Il tempo avanza di 100 giorni \(simulazione\)\. Oggi è il \d+ \w{3} \d{4}\./);
        assert.match(r.testo, /Nessun ricordo è sbiadito\./);
        r = oblio(archivio, 'tempo', '30');
        assert.match(r.testo, /In questo tempo Oblio ha dimenticato:/);
        assert.match(r.testo, /^ {4}diario\.txt {15}→ sbiadito {2}persi: originale \(\d+ parole, \d+ B\)$/m);
        r = oblio(archivio, 'tempo', '170');
        assert.match(r.testo, /→ essenza {3}persi: riassunto \(\d frasi su \d+, \d+ B\)/);
        r = oblio(archivio, 'tempo', '300');
        assert.match(r.testo, /→ traccia {3}persi: essenza \(1 frase \+ parole chiave, \d+ B\)/);
        const s = oblio(archivio, 'stato').testo;
        assert.match(s, /^ {2}diario\.txt {15}traccia {3}░░░░░░░░░░ — {4}solo la descrizione {9}—$/m);
        assert.match(s, /\(tempo simulato: \+600 giorni\)/);
        assert.match(oblio(archivio, 'tempo').testo, /Oggi è il .+ \(spostamento simulato: 600 giorni\)\./);
        assert.match(oblio(archivio, 'tempo', 'reset').testo, /Orologio riportato a oggi: .+\./);
        assert.equal(contesto(archivio).stato.offsetGiorni, 0);
        assert.equal(oblioErrore(archivio, 'tempo', 'tanti'), "Numero di giorni non valido: 'tanti'");
        // i giorni possono essere negativi, come con [int]::TryParse
        oblio(archivio, 'tempo', '-5');
        assert.equal(contesto(archivio).stato.offsetGiorni, -5);
    } finally { pulisci(base); }
});

test('"Da quando non ci vedevamo": l\'oblio avviene prima di ogni comando', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota qualunque. Con due frasi.'));
        // sposto l'orologio a mano, come se fossero passati 200 giorni
        const P = percorsi(archivio);
        const stato = JSON.parse(fs.readFileSync(P.stato, 'utf8'));
        stato.offsetGiorni = 200;
        fs.writeFileSync(P.stato, JSON.stringify(stato));
        const r = oblio(archivio, 'cerca', 'nota');
        assert.match(r.testo, /Da quando non ci vedevamo, Oblio ha dimenticato:\n {4}note\.txt {17}→ sbiadito {2}persi: originale/);
    } finally { pulisci(base); }
});

test('crypto-shredding vero: dopo l\'oblio la chiave non c\'è più e lo strato non si decifra', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'segreto.txt', 'La combinazione della cassaforte è 4-8-15-16-23-42.'));
        const v = voce(archivio, 'segreto.txt');
        const blobPercorso = path.join(archivio, '.oblio', 'strati', v.id, 'originale.bin');
        const copiaDiBackup = fs.readFileSync(blobPercorso);   // "una copia sopravvive in un backup"
        const chiaviPrima = JSON.parse(fs.readFileSync(path.join(archivio, '.oblio', 'chiavi.json'), 'utf8'));
        assert.ok(chiaviPrima[`${v.id}/originale`]);

        oblio(archivio, 'tempo', '130');

        const chiaviDopo = JSON.parse(fs.readFileSync(path.join(archivio, '.oblio', 'chiavi.json'), 'utf8'));
        assert.equal(chiaviDopo[`${v.id}/originale`], undefined, 'la chiave è distrutta');
        assert.ok(chiaviDopo[`${v.id}/riassunto`], 'gli strati più poveri restano');
        assert.ok(!fs.existsSync(blobPercorso), 'il file cifrato è rimosso');
        const vd = voce(archivio, 'segreto.txt');
        const s = vd.strati.find(x => x.nome === 'originale');
        assert.equal(s.vivo, false);
        assert.match(s.dimenticatoIl, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
        // nessuna delle chiavi rimaste apre la copia di backup
        for (const k of Object.values(chiaviDopo)) {
            assert.throws(() => sproteggiStrato(copiaDiBackup, Buffer.from(k, 'base64')), /manomesso o chiave sbagliata/);
        }
        // nello stato resta solo la traccia (descrizione e parole chiave), mai il testo
        assert.ok(!fs.readFileSync(path.join(archivio, '.oblio', 'stato.json'), 'utf8').includes('4-8-15-16-23-42'));
    } finally { pulisci(base); }
});

test('apri: originale intatto, poi ricordo ricostruito marcato, poi traccia', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'diario.txt', DIARIO));
        let r = oblio(archivio, 'apri', 'diario');
        assert.match(r.testo, /^ {2}Aperto: {2}diario\.txt$/m);
        assert.match(r.testo, /^ {2}Fonte: {3}originale, intatto$/m);
        assert.equal(fs.readFileSync(path.join(archivio, 'ricordi', 'diario.txt'), 'utf8'), DIARIO);
        assert.match(r.testo, /Riconsolidato: stabilità 180 → 450 giorni\. Da qui in poi sbiadisce più lentamente\./);

        oblio(archivio, 'tempo', '400');   // S = 450: perde l'originale (soglia 0,5 a ~312 giorni)
        r = oblio(archivio, 'apri', 'diario.txt');
        assert.match(r.testo, /Fonte: {3}ricostruito dallo strato «riassunto» \(\d frasi su \d+\)/);
        const ricordo = fs.readFileSync(path.join(archivio, 'ricordi', 'diario.ricordo.txt'));
        assert.deepEqual([...ricordo.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 con BOM come la versione Windows');
        const t = ricordo.toString('utf8').slice(1);
        assert.ok(t.startsWith("=== RICORDO RICOSTRUITO — NON È L'ORIGINALE ===\r\nFonte: strato «riassunto»"));
        assert.match(r.testo, /stabilità 450 → 1\.125 giorni/);

        oblio(archivio, 'tempo', '5000');
        r = oblio(archivio, 'apri', 'diario.txt');
        assert.match(r.testo, /Fonte: {3}solo la traccia: il contenuto è dimenticato/);
        assert.doesNotMatch(r.testo, /Riconsolidato/, 'una traccia non ha più nulla da rafforzare');
        const traccia = fs.readFileSync(path.join(archivio, 'ricordi', 'diario.traccia.txt'), 'utf8').slice(1);
        assert.match(traccia, /^TRACCIA DI UN FILE DIMENTICATO\r\n\r\nNome: {8}diario\.txt\r\nDescrizione: Testo di/);
        assert.match(traccia, /Di questo file resta solo la traccia: il contenuto non esiste più da nessuna parte\.$/);
        assert.equal(voce(archivio, 'diario.txt').accessi, 3);
        assert.equal(voce(archivio, 'diario.txt').stabilita, 1125);
    } finally { pulisci(base); }
});

test('riconsolidamento: S × 2,5 a ogni apertura, fino a 10 anni', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Promemoria importante per domani.'));
        const attese = [450, 1125, 2812.5, 3650, 3650];
        for (const atteso of attese) {
            oblio(archivio, 'apri', 'note.txt');
            assert.equal(voce(archivio, 'note.txt').stabilita, atteso);
        }
        assert.match(oblio(archivio, 'apri', 'note.txt').testo, /stabilità 3\.650 → 3\.650 giorni/);
        // dopo l'apertura la vitalità riparte da 1
        const ctx = contesto(archivio);
        assert.ok(istantanea(ctx).voci[0].vitalita > 0.9999);
    } finally { pulisci(base); }
});

test('ricostruzione di un\'immagine: stesse dimensioni dell\'originale e fascia scura col testo', conSips, () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'mare.jpg', codificaJpeg(foto(960, 640), 90)));
        oblio(archivio, 'tempo', '400');      // resta la miniatura (soglia 0,05 a ~539 giorni)
        const r = oblio(archivio, 'apri', 'mare');
        assert.match(r.testo, /Fonte: {3}ricostruito dallo strato «miniatura» \(64×43 px\)/);
        const out = path.join(archivio, 'ricordi', 'mare.ricordo.jpg');
        const img = decodifica(fs.readFileSync(out));
        assert.deepEqual([img.larghezza, img.altezza], [960, 640]);
        const px = (x, y) => img.dati[(y * 960 + x) * 4 + 2];
        const h = Math.max(24, Math.round(640 * 0.07));
        assert.ok(px(3, 640 - 3) < 90, 'il bordo della fascia è scuro');
        assert.ok(px(3, 640 - h - 8) > 150, 'sopra la fascia c\'è il cielo');
        let bianchi = 0;
        for (let y = 640 - h; y < 640; y++) for (let x = 0; x < 960; x++) { const o = (y * 960 + x) * 4; if (img.dati[o] > 220 && img.dati[o + 1] > 220) bianchi++; }
        assert.ok(bianchi > 400, `testo bianco nella fascia: ${bianchi} pixel`);
        assert.equal(r.risultato.apertura.ricostruito, true);
    } finally { pulisci(base); }
});

test('cerca: nel nome, nella traccia e nel testo dello strato rimasto', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'diario.txt', DIARIO));
        oblio(archivio, 'aggiungi', scriviFile(base, 'mare-vecchio.bin', Buffer.alloc(100)));
        let r = oblio(archivio, 'cerca', 'MELANZANE');
        assert.match(r.testo, /^ {2}diario\.txt {15}nitido {4}trovato nel testo \(originale\)$/m);
        r = oblio(archivio, 'cerca', 'mare');
        assert.match(r.testo, /diario\.txt .* trovato nella traccia, nel testo \(originale\)/);
        assert.match(r.testo, /mare-vecchio\.bin .* trovato nel nome/);
        assert.match(r.testo, /^ {6}Testo di \d+ parole/m);

        // dopo l'oblio totale la traccia resta cercabile
        oblio(archivio, 'tempo', '3000');
        r = oblio(archivio, 'cerca', 'mare');
        assert.match(r.testo, /diario\.txt {15}traccia {3}trovato nella traccia$/m);
        assert.match(oblio(archivio, 'cerca', 'zebra').testo, /Nessun ricordo contiene 'zebra'\./);
        assert.equal(oblioErrore(archivio, 'cerca', ''), 'Cosa devo cercare?  oblio cerca <parola>');
    } finally { pulisci(base); }
});

test('fissa e libera', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'contratto-casa.txt', 'Testo del contratto.'));
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota. Due note.'));
        assert.equal(voce(archivio, 'contratto-casa.txt').fissato, true);
        let r = oblio(archivio, 'libera', 'contratto');
        assert.match(r.testo, /contratto-casa\.txt torna a seguire il corso dell'oblio, a partire da oggi\./);
        assert.equal(voce(archivio, 'contratto-casa.txt').motivoFissato, '');
        oblio(archivio, 'tempo', '150');
        r = oblio(archivio, 'fissa', 'note');
        assert.match(r.testo, /note\.txt ora è indimenticabile\./);
        assert.match(r.testo, /Ciò che era già sbiadito non torna: resterà per sempre così \(sbiadito\)\./);
        assert.equal(voce(archivio, 'note.txt').motivoFissato, 'scelto da te');
        oblio(archivio, 'tempo', '5000');
        assert.equal(oblio(archivio, 'stato').testo.match(/^ {2}note\.txt .*$/m)[0].replace(/\s+/g, ' '), ' note.txt sbiadito fissato riassunto · 1 frasi su 2 mai');
        assert.match(oblio(archivio, 'apri', 'note').testo, /È fissato: non sbiadirà mai\./);
    } finally { pulisci(base); }
});

test('dimentica: senza -Conferma avvisa, con -Conferma distrugge tutto', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'foto vacanze.txt', 'Ricordi delle vacanze.'));
        const v = voce(archivio, 'foto vacanze.txt');
        let r = oblio(archivio, 'dimentica', 'vacanze');
        assert.match(r.testo, /Stai per dimenticare PER SEMPRE 'foto vacanze\.txt': chiavi distrutte, traccia cancellata, nessun ritorno\./);
        assert.match(r.testo, /Per procedere: {2}oblio dimentica "foto vacanze\.txt" -Conferma/);
        assert.ok(voce(archivio, 'foto vacanze.txt'));
        r = oblio(archivio, 'dimentica', 'vacanze', { conferma: true });
        assert.match(r.testo, /'foto vacanze\.txt' è stato dimenticato per sempre\./);
        assert.equal(voce(archivio, 'foto vacanze.txt'), undefined);
        assert.ok(!fs.existsSync(path.join(archivio, '.oblio', 'strati', v.id)));
        const chiavi = JSON.parse(fs.readFileSync(path.join(archivio, '.oblio', 'chiavi.json'), 'utf8'));
        assert.equal(Object.keys(chiavi).filter(k => k.startsWith(v.id)).length, 0);
        assert.equal(contesto(archivio).stato.dimenticatiPerSempre, 1);
        assert.match(oblio(archivio, 'stato').testo, /L'archivio è vuoto/);
    } finally { pulisci(base); }
});

test('trova il file: nome esatto, id, parte del nome; errori chiari', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'mare.txt', 'Il mare.'));
        oblio(archivio, 'aggiungi', scriviFile(base, 'mare-2.txt', 'Il mare di nuovo.'));
        const id = voce(archivio, 'mare.txt').id;
        assert.match(oblio(archivio, 'apri', 'MARE.TXT').testo, /Aperto: {2}mare\.txt/);
        assert.match(oblio(archivio, 'apri', id).testo, /Aperto: {2}mare\.txt/);
        assert.match(oblio(archivio, 'apri', '-2').testo, /Aperto: {2}mare-2\.txt/);
        assert.equal(oblioErrore(archivio, 'apri', 'ar'), "Più file corrispondono a 'ar': mare.txt, mare-2.txt");
        assert.equal(oblioErrore(archivio, 'apri', 'monti'), "Nessun file chiamato 'monti' nell'archivio.");
        assert.equal(oblioErrore(archivio, 'fissa', ''), 'Indica il nome di un file.');
    } finally { pulisci(base); }
});

test('velocità: cambia la curva per tutti i file', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota. Due note.'));
        let r = oblio(archivio, 'velocita', 'pesce-rosso');
        assert.match(r.testo, /^ {2}▶ pesce-rosso {2}nitido ~31 gg · sbiadito fino a ~72 gg · essenza fino a ~135 gg, poi traccia$/m);
        assert.match(r.testo, /^ {4}normale {6}nitido ~125 gg/m);
        oblio(archivio, 'tempo', '40');
        assert.equal(voce(archivio, 'note.txt').strati.find(s => s.nome === 'originale').vivo, false);
        r = oblio(archivio, 'velocità', 'ELEFANTE');
        assert.match(r.testo, /▶ elefante/);
        assert.equal(contesto(archivio).stato.velocita, 'elefante');
        assert.equal(oblioErrore(archivio, 'velocita', 'lumaca'), "Velocità sconosciuta: 'lumaca'. Scegli tra: elefante, normale, pesce-rosso");
        assert.match(oblio(archivio, 'velocita').testo, /▶ elefante/);
    } finally { pulisci(base); }
});

test('stato: istogramma, spazio e tabella come nella versione Windows', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'a.txt', 'Prima nota. Seconda frase.'));
        oblio(archivio, 'aggiungi', scriviFile(base, 'bolletta.txt', 'Da pagare.'));
        const t = oblio(archivio, 'stato').testo;
        assert.match(t, /^ {2}OBLIO · .+archivio$/m);
        assert.match(t, /^ {2}oggi \d+ \w{3} \d{4} · velocità dell'oblio: normale$/m);
        assert.match(t, /^ {2}nitidi {6}2 {2}█{20}$/m);
        assert.match(t, /^ {2}sbiaditi {4}0 {2}$/m);
        assert.match(t, /^ {2}fissati {5}1 {2}\(indimenticabili\)$/m);
        assert.match(t, /^ {2}spazio: \d+ B all'origine → \d+ B oggi \(\+\d+%\)$/m);
        assert.match(t, /^ {2}FILE {21}STATO {5}VITALITÀ {8}COSA RESTA {18}PROSSIMO OBLIO$/m);
        assert.match(t, /^ {2}a\.txt {20}nitido {4}██████████ 1,00 originale · 4 parole {8}tra 125 giorni$/m);
        assert.match(t, /^ {2}bolletta\.txt {13}nitido {4}fissato {9}originale · 2 parole {8}mai$/m);
    } finally { pulisci(base); }
});

test('novità: oblio domani', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota. Due note.'));
        assert.match(oblio(archivio, 'domani').testo, /Nei prossimi 30 giorni non sbiadirà nulla, anche senza riaprire niente\./);
        oblio(archivio, 'tempo', '110');
        const r = oblio(archivio, 'domani');
        assert.match(r.testo, /Nei prossimi 30 giorni, se non riapri nulla, Oblio dimenticherà:/);
        assert.match(r.testo, /^ {4}note\.txt {17}tra 15 giorni {2}perde originale \(4 parole, 19 B\) → sbiadito$/m);
        assert.equal(r.risultato.previsioni.length, 1);
        assert.equal(oblio(archivio, 'domani', '1000').risultato.previsioni.length, 3);
        assert.equal(oblioErrore(archivio, 'domani', 'presto'), "Numero di giorni non valido: 'presto'");
        // domani non cambia niente
        assert.equal(voce(archivio, 'note.txt').strati.every(s => s.vivo), true);
    } finally { pulisci(base); }
});

test('comandi: aiuto e comando sconosciuto', () => {
    const base = cartellaTemporanea();
    try {
        const a = oblio(path.join(base, 'x'), 'aiuto').testo;
        assert.match(a, /OBLIO — il file system che dimentica come un essere umano/);
        for (const c of ['crea', 'aggiungi', 'stato', 'apri', 'cerca', 'fissa', 'libera', 'dimentica', 'velocita', 'tempo']) {
            assert.match(a, new RegExp(`^  oblio ${c}\\b`, 'm'), c);
        }
        assert.match(a, /Opzione per tutti i comandi: {2}-Archivio <cartella> {3}\(oppure la variabile OBLIO_ARCHIVIO\)/);
        assert.equal(oblio(path.join(base, 'x'), 'HELP').testo, a);
        assert.equal(oblioErrore(path.join(base, 'x'), 'vola'), "Comando sconosciuto: 'vola'. Scrivi:  oblio aiuto");
    } finally { pulisci(base); }
});

test('anteprima per il web: lo strato migliore senza riconsolidare', conSips, () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'mare.jpg', codificaJpeg(foto(800, 500), 85)));
        oblio(archivio, 'aggiungi', scriviFile(base, 'diario.txt', DIARIO));
        oblio(archivio, 'aggiungi', scriviFile(base, 'x.bin', Buffer.alloc(5)));
        const ctx = contesto(archivio);
        const img = anteprima(ctx, ctx.stato.voci.find(v => v.nome === 'mare.jpg'));
        assert.equal(img.strato, 'media');
        assert.equal(img.mime, 'image/jpeg');
        const txt = anteprima(ctx, ctx.stato.voci.find(v => v.nome === 'diario.txt'));
        assert.equal(txt.testo, DIARIO);
        assert.equal(anteprima(ctx, ctx.stato.voci.find(v => v.nome === 'x.bin')), null);
        assert.equal(voce(archivio, 'diario.txt').accessi, 0, 'guardare l\'anteprima non è aprire');
        const foto2 = istantanea(ctx);
        assert.deepEqual(Object.keys(foto2.gruppi), ['nitido', 'sbiadito', 'essenza', 'traccia']);
    } finally { pulisci(base); }
});

test('nomeLibero e salvataggio anche quando il comando fallisce', () => {
    assert.equal(nomeLibero({ voci: [{ nome: 'a.txt' }, { nome: 'A (2).txt' }] }, 'A.TXT'), 'A (3).TXT');
    assert.equal(nomeLibero({ voci: [] }, 'nuovo'), 'nuovo');
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'note.txt', 'Una nota. Due note.'));
        const P = percorsi(archivio);
        const stato = JSON.parse(fs.readFileSync(P.stato, 'utf8'));
        stato.offsetGiorni = 200;
        fs.writeFileSync(P.stato, JSON.stringify(stato));
        assert.ok(oblioErrore(archivio, 'apri', 'inesistente'));
        // l'oblio avvenuto prima dell'errore è stato salvato: chiave e strato spariti insieme
        const v = voce(archivio, 'note.txt');
        assert.equal(v.strati.find(s => s.nome === 'originale').vivo, false);
        const chiavi = JSON.parse(fs.readFileSync(P.chiavi, 'utf8'));
        assert.equal(chiavi[`${v.id}/originale`], undefined);
    } finally { pulisci(base); }
});

test('una voce con lo strato rovinato si apre dallo strato successivo', () => {
    const { base, archivio } = nuovoArchivio();
    try {
        oblio(archivio, 'aggiungi', scriviFile(base, 'diario.txt', DIARIO));
        const v = voce(archivio, 'diario.txt');
        const blob = path.join(archivio, '.oblio', 'strati', v.id, 'originale.bin');
        const b = fs.readFileSync(blob); b[20] ^= 0xff; fs.writeFileSync(blob, b);
        const r = oblio(archivio, 'apri', 'diario');
        assert.match(r.testo, /ricostruito dallo strato «riassunto»/);
        assert.equal(voce(archivio, 'diario.txt').strati.find(s => s.nome === 'originale').vivo, false);
        void leggiBMP; void scriviBMP;
    } finally { pulisci(base); }
});

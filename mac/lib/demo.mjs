// Demo di Oblio: crea alcuni file di prova, li affida all'oblio
// e simula più di un anno di vita dell'archivio.
// Tutto avviene nella cartella "mac/demo" (la demo Windows, in "oblio/demo", non si tocca).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { esegui, Uscita } from './archivio.mjs';
import { Tela } from './disegno.js';
import { CasualeNet } from './casuale.js';
import { codificaJpeg, codificaPng } from './sips.mjs';
import { arrotondaPari as int } from './formato.js';

export const CARTELLA_MAC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CARTELLA_DEMO = path.join(CARTELLA_MAC, 'demo');

const W = 2400, H = 1600;
const colore = (r, g, b, a = 255) => [r, g, b, a];

// ---------------------------------------------------------------------------
// File di prova: le stesse tre foto della demo Windows, dipinte con lo stesso
// generatore casuale (System.Random con seme 42) e nello stesso ordine.
// ---------------------------------------------------------------------------
export function dipingiMare(rnd) {
    const t = new Tela(W, H);
    t.sfumatura(0, 0, 2400, 820, colore(110, 170, 230), colore(230, 242, 250));
    t.ellisse(1720, 170, 240, 240, colore(255, 225, 110));
    t.sfumatura(0, 820, 2400, 360, colore(40, 120, 190), colore(20, 80, 150));
    for (let i = 0; i < 1400; i++) {
        const a = rnd.prossimo(60, 180);
        const x = rnd.prossimo(0, 2400), y = rnd.prossimo(830, 1170), w = rnd.prossimo(8, 40);
        t.ellisse(x, y, w, 3, colore(255, 255, 255, a));
    }
    t.sfumatura(0, 1180, 2400, 420, colore(238, 214, 170), colore(214, 186, 140));
    for (let i = 0; i < 2500; i++) {
        const a = rnd.prossimo(40, 140);
        const x = rnd.prossimo(0, 2400), y = rnd.prossimo(1185, 1600);
        t.ellisse(x, y, 4, 4, colore(150, 120, 80, a));
    }
    t.rettangolo(596, 1010, 10, 420, colore(90, 70, 50));
    t.spicchio(420, 930, 360, 180, 180, 180, colore(210, 50, 50));
    t.rettangolo(880, 1350, 320, 140, colore(40, 150, 140));
    return t.img;
}

export function dipingiTramonto(rnd) {
    const t = new Tela(W, H);
    t.sfumatura(0, 0, 2400, 1100, colore(70, 40, 110), colore(250, 140, 60));
    for (let i = 0; i < 250; i++) {
        const d = rnd.prossimo(2, 6);
        const a = rnd.prossimo(80, 220);
        const x = rnd.prossimo(0, 2400), y = rnd.prossimo(0, 450);
        t.ellisse(x, y, d, d, colore(255, 255, 230, a));
    }
    t.ellisse(1000, 820, 400, 400, colore(255, 90, 50));
    const punti = [[0, 1600]];
    for (let x = 0; x <= 2400; x += 20) {
        punti.push([x, int(1080 + 70 * Math.sin(x / 260.0) + 40 * Math.sin(x / 97.0))]);
    }
    punti.push([2400, 1600]);
    t.poligono(punti, colore(35, 20, 45));
    t.rettangolo(1700, 1000, 180, 140, colore(25, 15, 30));
    t.rettangolo(1740, 1040, 40, 40, colore(255, 210, 120));
    return t.img;
}

export function dipingiBosco(rnd) {
    const t = new Tela(W, H);
    t.sfumatura(0, 0, 2400, 700, colore(200, 220, 210), colore(150, 180, 160));
    t.sfumatura(0, 700, 2400, 900, colore(60, 100, 50), colore(30, 60, 30));
    for (let i = 0; i < 260; i++) {
        const x = rnd.prossimo(-100, 2400);
        const base = 650 + int(1000 * i / 260) + rnd.prossimo(-20, 20);
        const alt = int((base - 400) * 0.9);
        const lar = int(alt * 0.45);
        const verde = colore(rnd.prossimo(20, 60), rnd.prossimo(80, 140), rnd.prossimo(30, 70));
        t.poligono([[int(x + lar / 2), base - alt], [x, base], [x + lar, base]], verde);
        t.rettangolo(int(x + lar / 2 - 6), base, 12, 30, colore(70, 50, 30));
    }
    return t.img;
}

export const TESTI = {
    'diario-estate.txt': `Il 12 agosto siamo arrivati al mare poco prima del tramonto, stanchi ma felici. La nonna aveva preparato la pasta con le melanzane e il profumo arrivava fino al cancello. Dopo cena siamo scesi in spiaggia a piedi nudi e la sabbia era ancora calda. Luca ha trovato una conchiglia enorme e ha giurato che l'avrebbe tenuta per sempre.

Il mare quella sera era calmo, quasi immobile, e rifletteva le luci del paese. Abbiamo parlato a lungo della casa nuova e del lavoro che comincia a settembre. Io avevo paura del cambiamento, ma la nonna ha riso e ha detto che le case si riempiono da sole. Più tardi è arrivato lo zio Franco con la chitarra e abbiamo cantato fino a mezzanotte. Nessuno ricordava le parole delle canzoni, ma non importava a nessuno.

Prima di dormire ho scritto queste righe per non dimenticare la sera al mare con la nonna. Forse tra qualche anno non ricorderò il colore del cielo, ma spero di ricordare la sua risata. Domani si torna in città.`,
    'appunti-trasloco.txt': `Trasloco fissato per sabato 3 ottobre, il ritiro degli scatoloni è giovedì.
Chiamare la ditta per confermare il furgone e l'orario del mattino.
Smontare la libreria del soggiorno e l'armadio della camera.
Etichettare gli scatoloni per stanza: cucina, bagno, studio.
Disdire internet nella vecchia casa e attivarlo nella nuova entro fine mese.
Comunicare il nuovo indirizzo alla banca e al medico.
Lasciare le chiavi al vicino del piano di sotto.`,
    'fattura-luce-settembre.txt': `FATTURA N. 2026/0917
Fornitura di energia elettrica, periodo 1-30 settembre 2026
Consumo: 212 kWh
Totale da pagare: 64,80 euro
Scadenza: 20 ottobre 2026`,
};

export const DATE = {
    'mare.jpg': '2026-08-12', 'tramonto.png': '2026-08-13', 'bosco.jpg': '2026-09-02',
    'diario-estate.txt': '2026-08-12', 'appunti-trasloco.txt': '2026-09-20',
    'fattura-luce-settembre.txt': '2026-10-01', 'backup-vecchio.bin': '2023-05-04',
};

// Crea i sette file di prova nella cartella indicata.
export function preparaFileDiProva(materiale) {
    fs.mkdirSync(materiale, { recursive: true });
    const rnd = new CasualeNet(42);
    fs.writeFileSync(path.join(materiale, 'mare.jpg'), codificaJpeg(dipingiMare(rnd), 92));
    fs.writeFileSync(path.join(materiale, 'tramonto.png'), codificaPng(dipingiTramonto(rnd)));
    fs.writeFileSync(path.join(materiale, 'bosco.jpg'), codificaJpeg(dipingiBosco(rnd), 92));
    for (const [nome, testo] of Object.entries(TESTI)) fs.writeFileSync(path.join(materiale, nome), testo, 'utf8');
    fs.writeFileSync(path.join(materiale, 'backup-vecchio.bin'), rnd.byte(1572864));
    for (const [nome, giorno] of Object.entries(DATE)) {
        const [a, m, g] = giorno.split('-').map(Number);
        const quando = new Date(a, m - 1, g, 18, 30);
        fs.utimesSync(path.join(materiale, nome), quando, quando);
    }
}

// ---------------------------------------------------------------------------
// La storia
// ---------------------------------------------------------------------------
export function eseguiDemo({ cartella = CARTELLA_DEMO, scrivi = null } = {}) {
    const marcatore = path.join(cartella, '.demo-oblio');
    const materiale = path.join(cartella, 'file-di-prova');
    const archivio = path.join(cartella, 'archivio');
    const uscita = new Uscita(scrivi);

    if (fs.existsSync(cartella)) {
        if (!fs.existsSync(marcatore)) throw new Error(`La cartella '${cartella}' esiste ma non l'ha creata la demo: non la tocco.`);
        fs.rmSync(cartella, { recursive: true, force: true });
    }
    fs.mkdirSync(materiale, { recursive: true });
    fs.writeFileSync(marcatore, 'Cartella generata da demo.mjs: viene ricreata a ogni esecuzione.\n');

    const oblio = (comando, argomento = '', extra = {}) => esegui(comando, argomento, { archivio, ...extra }, uscita);
    const titolo = testo => { uscita.riga(''); uscita.riga(''); uscita.riga(`━━━ ${testo}`, 'Magenta'); };

    uscita.riga('');
    uscita.riga('  Preparo i file di prova...', 'DarkGray');
    preparaFileDiProva(materiale);

    titolo('1 · Affido a Oblio sette file: tre foto, tre testi (tra cui una fattura) e un vecchio backup');
    oblio('crea');
    oblio('aggiungi', materiale, { sposta: true });
    oblio('stato');

    titolo('2 · Passano 90 giorni. Riguardo solo la foto del tramonto.');
    oblio('tempo', '90');
    oblio('apri', 'tramonto.png');

    titolo("3 · Passano altri 60 giorni senza aprire nient'altro.");
    oblio('tempo', '60');
    oblio('stato');

    titolo('4 · Riapro la foto del mare e il diario: ormai sono sbiaditi.');
    oblio('apri', 'mare.jpg');
    oblio('apri', 'diario-estate.txt');

    titolo('5 · Passa un anno.');
    oblio('tempo', '365');
    oblio('stato');

    titolo('6 · Cerco "mare": la traccia resta anche quando il file è sbiadito.');
    oblio('cerca', 'mare');

    titolo('7 · Cosa resta del bosco e del vecchio backup?');
    oblio('apri', 'bosco.jpg');
    oblio('apri', 'backup-vecchio.bin');

    titolo('Fine');
    uscita.riga(`  I ricordi ricostruiti sono in:  ${path.join(archivio, 'ricordi')}`);
    uscita.riga('  Confronta mare.ricordo.jpg (da 480 px) con bosco.ricordo.jpg (da 64 px).');
    uscita.riga('');
    return { cartella, archivio, uscita };
}

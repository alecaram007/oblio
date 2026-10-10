// Immagini in JavaScript puro: lettura e scrittura BMP, ridimensionamento
// bicubico di buona qualità, nomi dei colori, descrizione e fascia
// «RICORDO RICOSTRUITO · NON ORIGINALE».
// Un'immagine è { larghezza, altezza, dati } con dati RGBA (Uint8Array).
// Modulo condiviso tra Node e browser: nessun import di node:*.

import { formatData, arrotondaPari } from './formato.js';
import { misuraTesto, disegnaTesto } from './font.js';

export function nuovaImmagine(larghezza, altezza, sfondo = [255, 255, 255, 255]) {
    const dati = new Uint8Array(larghezza * altezza * 4);
    for (let i = 0; i < dati.length; i += 4) {
        dati[i] = sfondo[0]; dati[i + 1] = sfondo[1]; dati[i + 2] = sfondo[2]; dati[i + 3] = sfondo[3];
    }
    return { larghezza, altezza, dati };
}

// ---------------------------------------------------------------------------
// BMP
// ---------------------------------------------------------------------------
function maschera(m) {
    if (!m) return { spost: 0, max: 0 };
    let spost = 0;
    while (((m >>> spost) & 1) === 0 && spost < 32) spost++;
    let bit = 0;
    while (((m >>> (spost + bit)) & 1) === 1 && spost + bit < 32) bit++;
    return { spost, max: 2 ** bit - 1 };
}

// Legge BMP a 1, 4, 8, 16, 24 e 32 bit (BI_RGB e BI_BITFIELDS), dall'alto o dal basso.
// La trasparenza viene composta su fondo bianco, come faceva la versione Windows.
export function leggiBMP(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) throw new Error('non è un file BMP');
    const inizioPixel = dv.getUint32(10, true);
    const intestazione = dv.getUint32(14, true);
    let larghezza, altezzaGrezza, bpp, compressione = 0, colori = 0;
    if (intestazione === 12) {
        larghezza = dv.getUint16(18, true); altezzaGrezza = dv.getInt16(20, true); bpp = dv.getUint16(24, true);
    } else {
        larghezza = dv.getInt32(18, true); altezzaGrezza = dv.getInt32(22, true);
        bpp = dv.getUint16(28, true); compressione = dv.getUint32(30, true);
        colori = dv.getUint32(46, true);
    }
    const dallAlto = altezzaGrezza < 0;
    const altezza = Math.abs(altezzaGrezza);
    if (larghezza <= 0 || altezza <= 0) throw new Error('BMP senza dimensioni');
    if (compressione !== 0 && compressione !== 3 && compressione !== 6) throw new Error('BMP compresso non gestito');

    let mR = 0x00ff0000, mG = 0x0000ff00, mB = 0x000000ff, mA = 0;
    if (bpp === 16) { mR = 0x7c00; mG = 0x03e0; mB = 0x001f; }
    if (compressione === 3 || compressione === 6) {
        const base = 54; // subito dopo l'intestazione da 40 byte, oppure dentro V4/V5
        mR = dv.getUint32(base, true); mG = dv.getUint32(base + 4, true); mB = dv.getUint32(base + 8, true);
        if (intestazione >= 56 || compressione === 6) mA = dv.getUint32(base + 12, true);
    } else if (bpp === 32 && intestazione >= 108) {
        // V4/V5 senza bitfields: niente alfa affidabile
        mA = 0;
    }
    const R = maschera(mR), G = maschera(mG), B = maschera(mB), A = maschera(mA);

    let tavolozza = null;
    if (bpp <= 8) {
        const n = colori || (1 << bpp);
        const voce = intestazione === 12 ? 3 : 4;
        const inizio = 14 + intestazione + ((compressione === 3 && intestazione === 40) ? 12 : 0);
        tavolozza = [];
        for (let i = 0; i < n; i++) {
            const o = inizio + i * voce;
            tavolozza.push([b[o + 2], b[o + 1], b[o]]);
        }
    }

    const passo = Math.floor((bpp * larghezza + 31) / 32) * 4;
    const dati = new Uint8Array(larghezza * altezza * 4);
    let alfaUsata = false;
    for (let y = 0; y < altezza; y++) {
        const riga = inizioPixel + (dallAlto ? y : altezza - 1 - y) * passo;
        for (let x = 0; x < larghezza; x++) {
            const o = (y * larghezza + x) * 4;
            let r, g, bl, a = 255;
            if (bpp === 24) {
                const p = riga + x * 3; bl = b[p]; g = b[p + 1]; r = b[p + 2];
            } else if (bpp === 32 || bpp === 16) {
                const v = bpp === 32 ? dv.getUint32(riga + x * 4, true) : dv.getUint16(riga + x * 2, true);
                r = R.max ? Math.round(((v >>> R.spost) & R.max) * 255 / R.max) : 0;
                g = G.max ? Math.round(((v >>> G.spost) & G.max) * 255 / G.max) : 0;
                bl = B.max ? Math.round(((v >>> B.spost) & B.max) * 255 / B.max) : 0;
                if (A.max) { a = Math.round(((v >>> A.spost) & A.max) * 255 / A.max); if (a !== 255) alfaUsata = true; }
            } else {
                const bitPos = x * bpp;
                const byte = b[riga + (bitPos >> 3)];
                const indice = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
                [r, g, bl] = tavolozza[indice] || [0, 0, 0];
            }
            dati[o] = r; dati[o + 1] = g; dati[o + 2] = bl; dati[o + 3] = a;
        }
    }
    // Un canale alfa tutto a zero è quasi sempre "non usato": lo ignoriamo.
    if (alfaUsata) {
        let tuttoZero = true;
        for (let i = 3; i < dati.length; i += 4) if (dati[i] !== 0) { tuttoZero = false; break; }
        for (let i = 0; i < dati.length; i += 4) {
            if (tuttoZero) { dati[i + 3] = 255; continue; }
            const a = dati[i + 3] / 255;
            dati[i] = Math.round(dati[i] * a + 255 * (1 - a));
            dati[i + 1] = Math.round(dati[i + 1] * a + 255 * (1 - a));
            dati[i + 2] = Math.round(dati[i + 2] * a + 255 * (1 - a));
            dati[i + 3] = 255;
        }
    }
    return { larghezza, altezza, dati };
}

// Scrive un BMP dal basso verso l'alto: a 24 bit se l'immagine è opaca
// (il formato più compatibile), a 32 bit con canale alfa (BITMAPV5) se ha trasparenze.
export function scriviBMP(img) {
    const { larghezza: w, altezza: h, dati } = img;
    let alfa = false;
    for (let i = 3; i < dati.length; i += 4) if (dati[i] !== 255) { alfa = true; break; }
    const bpp = alfa ? 32 : 24;
    const intestazione = alfa ? 124 : 40;
    const inizio = 14 + intestazione;
    const passo = Math.floor((bpp * w + 31) / 32) * 4;
    const dimensione = inizio + passo * h;
    const out = new Uint8Array(dimensione);
    const dv = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x4d;
    dv.setUint32(2, dimensione, true);
    dv.setUint32(10, inizio, true);
    dv.setUint32(14, intestazione, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, bpp, true);
    dv.setUint32(30, alfa ? 3 : 0, true);
    dv.setUint32(34, passo * h, true);
    dv.setInt32(38, 3780, true);
    dv.setInt32(42, 3780, true);
    if (alfa) {
        dv.setUint32(54, 0x00ff0000, true);
        dv.setUint32(58, 0x0000ff00, true);
        dv.setUint32(62, 0x000000ff, true);
        dv.setUint32(66, 0xff000000, true);
        dv.setUint32(70, 0x73524742, true); // 'sRGB'
    }
    const n = bpp / 8;
    for (let y = 0; y < h; y++) {
        const riga = inizio + (h - 1 - y) * passo;
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4, p = riga + x * n;
            out[p] = dati[o + 2]; out[p + 1] = dati[o + 1]; out[p + 2] = dati[o];
            if (alfa) out[p + 3] = dati[o + 3];
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Ridimensionamento bicubico, con filtro allargato quando si rimpicciolisce:
// è l'equivalente di HighQualityBicubic di GDI+. Per rimpicciolire si usa
// Catmull-Rom (nitido), per ingrandire Mitchell-Netravali, più morbido:
// un ricordo ingrandito deve sembrare sfocato, non a quadretti.
// I bordi vengono riflessi (TileFlipXY), così non compaiono aloni.
// ---------------------------------------------------------------------------
function cubicaBC(B, C) {
    return x => {
        x = Math.abs(x);
        if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x * x + (6 - 2 * B)) / 6;
        if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x * x + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
        return 0;
    };
}
const CATMULL_ROM = cubicaBC(0, 0.5);
const MITCHELL = cubicaBC(1 / 3, 1 / 3);

function rifletti(i, n) {
    if (n === 1) return 0;
    const periodo = 2 * n;
    i = ((i % periodo) + periodo) % periodo;
    return i < n ? i : periodo - 1 - i;
}

function pesi(daN, aN) {
    const scala = daN / aN;
    const allarga = Math.max(1, scala);
    const supporto = 2 * allarga;
    const cubica = scala >= 1 ? CATMULL_ROM : MITCHELL;
    const tabella = [];
    for (let i = 0; i < aN; i++) {
        const centro = (i + 0.5) * scala - 0.5;
        const inizio = Math.floor(centro - supporto) + 1;
        const fine = Math.floor(centro + supporto);
        const indici = [], valori = [];
        let somma = 0;
        for (let j = inizio; j <= fine; j++) {
            const w = cubica((j - centro) / allarga);
            if (w === 0) continue;
            indici.push(rifletti(j, daN)); valori.push(w); somma += w;
        }
        tabella.push({ indici, valori: valori.map(v => v / somma) });
    }
    return tabella;
}

export function ridimensiona(img, w, h) {
    const { larghezza: W, altezza: H, dati } = img;
    const px = pesi(W, w), py = pesi(H, h);
    // passo orizzontale: H righe × w colonne, in virgola mobile
    const tmp = new Float32Array(w * H * 3);
    for (let y = 0; y < H; y++) {
        const base = y * W * 4;
        for (let x = 0; x < w; x++) {
            const { indici, valori } = px[x];
            let r = 0, g = 0, b = 0;
            for (let k = 0; k < indici.length; k++) {
                const o = base + indici[k] * 4, p = valori[k];
                r += dati[o] * p; g += dati[o + 1] * p; b += dati[o + 2] * p;
            }
            const t = (y * w + x) * 3;
            tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b;
        }
    }
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const { indici, valori } = py[y];
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0;
            for (let k = 0; k < indici.length; k++) {
                const t = (indici[k] * w + x) * 3, p = valori[k];
                r += tmp[t] * p; g += tmp[t + 1] * p; b += tmp[t + 2] * p;
            }
            const o = (y * w + x) * 4;
            out[o] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
            out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
            out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
            out[o + 3] = 255;
        }
    }
    return { larghezza: w, altezza: h, dati: out };
}

export function lato(larghezza, altezza, max) {
    const scala = Math.min(1.0, max / Math.max(larghezza, altezza));
    return [Math.max(1, arrotondaPari(larghezza * scala)), Math.max(1, arrotondaPari(altezza * scala))];
}

// ---------------------------------------------------------------------------
// Colori (stessi calcoli di System.Drawing.Color: luminosità, saturazione, tinta HSL)
// ---------------------------------------------------------------------------
export function hsl(r, g, b) {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    let s = 0, h = 0;
    if (max !== min) {
        s = l <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
        const d = max - min;
        if (R === max) h = (G - B) / d;
        else if (G === max) h = 2 + (B - R) / d;
        else h = 4 + (R - G) / d;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s, l };
}

export function nomeColore(r, g, b) {
    const { h, s, l } = hsl(r, g, b);
    if (l < 0.16) return 'nero';
    if (s < 0.18 || l > 0.93) return l > 0.8 ? 'bianco' : 'grigio';
    if (h >= 25 && h < 65 && l > 0.68 && s < 0.65) return 'beige';
    if (h < 15 || h >= 345) return l < 0.3 ? 'bordeaux' : 'rosso';
    if (h < 42) return l < 0.4 ? 'marrone' : 'arancione';
    if (h < 68) return l < 0.35 ? 'marrone' : 'giallo';
    if (h < 170) return 'verde';
    if (h < 215 || (h < 250 && l > 0.65)) return 'azzurro';
    if (h < 255) return 'blu';
    if (h < 290) return 'viola';
    return 'rosa';
}

// Nel prototipo la "descrizione" nasce dai colori. Una versione vera userebbe
// un modello di visione: "spiaggia con ombrellone rosso" invece di "azzurro, beige".
export function analisiColori(img) {
    const [w, h] = lato(img.larghezza, img.altezza, 24);
    const mini = ridimensiona(img, w, h);
    const conteggi = new Map();
    let luce = 0, n = 0;
    for (let i = 0; i < mini.dati.length; i += 4) {
        const nome = nomeColore(mini.dati[i], mini.dati[i + 1], mini.dati[i + 2]);
        conteggi.set(nome, (conteggi.get(nome) || 0) + 1);
        luce += hsl(mini.dati[i], mini.dati[i + 1], mini.dati[i + 2]).l;
        n++;
    }
    const classifica = [...conteggi.entries()].sort((a, b) => b[1] - a[1]);
    const colori = classifica.filter(e => e[1] / n >= 0.08).slice(0, 3).map(e => e[0]);
    const l = luce / n;
    const tono = l > 0.62 ? 'luminosa' : l < 0.35 ? 'scura' : 'dai toni medi';
    let forma = 'quadrata';
    if (img.larghezza > img.altezza * 1.1) forma = 'orizzontale';
    else if (img.altezza > img.larghezza * 1.1) forma = 'verticale';
    return { colori, tono, forma, luminosita: l, quote: classifica.map(([nome, c]) => ({ nome, quota: c / n })) };
}

export function descrizioneImmagine(img, data) {
    const a = analisiColori(img);
    return `Immagine ${a.forma} ${img.larghezza}×${img.altezza}, ${a.tono}; colori: ${a.colori.join(', ')} · ${formatData(data)}`;
}

// ---------------------------------------------------------------------------
// La fascia che marca un ricordo ricostruito: nero al 69% e testo bianco.
// ---------------------------------------------------------------------------
export function aggiungiFiligrana(img, testo) {
    const { larghezza: W, altezza: H, dati } = img;
    const h = Math.max(24, arrotondaPari(H * 0.07));
    const alfa = 175 / 255;
    for (let y = Math.max(0, H - h); y < H; y++) {
        for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4;
            dati[o] = Math.round(dati[o] * (1 - alfa));
            dati[o + 1] = Math.round(dati[o + 1] * (1 - alfa));
            dati[o + 2] = Math.round(dati[o + 2] * (1 - alfa));
        }
    }
    // Il carattere occupa circa metà della fascia e non esce mai dai bordi.
    const corpo = Math.min(h * 0.45, W / (testo.length * 0.62));
    const misura = misuraTesto(testo, corpo);
    const x0 = (W - misura.larghezza) / 2;
    const y0 = H - h + (h - misura.altezza) / 2;
    disegnaTesto(img, testo, x0, y0, corpo, [255, 255, 255]);
    return img;
}

// Un piccolo pittore in JavaScript puro: rettangoli, sfumature, ellissi,
// spicchi e poligoni con bordi morbidi (antialiasing a 4 sottorighe).
// Serve alla demo per dipingere le foto di prova come faceva System.Drawing.
// Modulo condiviso tra Node e browser: nessun import di node:*.

import { nuovaImmagine } from './immagine.js';

const SOTTORIGHE = 4;

export class Tela {
    constructor(larghezza, altezza) {
        // come una Bitmap nuova di System.Drawing: tutta trasparente
        this.img = nuovaImmagine(larghezza, altezza, [0, 0, 0, 0]);
        this.larghezza = larghezza;
        this.altezza = altezza;
        this.copertura = new Float32Array(larghezza + 2);
    }

    // colore: [r, g, b, a] con a tra 0 e 255; composizione "sopra" con la trasparenza
    fondi(o, colore, copertura) {
        const d = this.img.dati;
        const as = copertura * colore[3] / 255;
        if (as <= 0) return;
        const ad = d[o + 3] / 255;
        const ao = as + ad * (1 - as);
        const kd = ad * (1 - as);
        d[o] = Math.round((colore[0] * as + d[o] * kd) / ao);
        d[o + 1] = Math.round((colore[1] * as + d[o + 1] * kd) / ao);
        d[o + 2] = Math.round((colore[2] * as + d[o + 2] * kd) / ao);
        d[o + 3] = Math.round(ao * 255);
    }

    rettangolo(x, y, w, h, colore) {
        const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.larghezza, Math.round(x + w));
        const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.altezza, Math.round(y + h));
        for (let py = y0; py < y1; py++) {
            const base = py * this.larghezza * 4;
            for (let px = x0; px < x1; px++) this.fondi(base + px * 4, colore, 1);
        }
    }

    // Sfumatura verticale come LinearGradientBrush a 90°: il rettangolo del
    // pennello va da y-1 a y+altezza+1, il riempimento da y a y+altezza.
    sfumatura(x, y, w, h, da, a) {
        const inizio = y - 1, lunghezza = h + 2;
        const y0 = Math.max(0, y), y1 = Math.min(this.altezza, y + h);
        for (let py = y0; py < y1; py++) {
            const t = Math.min(1, Math.max(0, (py + 0.5 - inizio) / lunghezza));
            const c = [0, 1, 2, 3].map(i => da[i] + (a[i] - da[i]) * t);
            const base = py * this.larghezza * 4;
            for (let px = Math.max(0, x); px < Math.min(this.larghezza, x + w); px++) this.fondi(base + px * 4, c, 1);
        }
    }

    // Poligono pieno (regola pari-dispari) con copertura frazionaria ai bordi.
    poligono(punti, colore) {
        if (punti.length < 3) return;
        let minY = Infinity, maxY = -Infinity;
        for (const [, py] of punti) { minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
        const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.altezza - 1, Math.ceil(maxY));
        const W = this.larghezza;
        const cop = this.copertura;
        const n = punti.length;
        for (let py = y0; py <= y1; py++) {
            let minX = W, maxX = -1;
            for (let s = 0; s < SOTTORIGHE; s++) {
                const sy = py + (s + 0.5) / SOTTORIGHE;
                const xs = [];
                for (let i = 0, j = n - 1; i < n; j = i++) {
                    const [xi, yi] = punti[i], [xj, yj] = punti[j];
                    if ((yi > sy) !== (yj > sy)) xs.push(xi + (sy - yi) * (xj - xi) / (yj - yi));
                }
                xs.sort((p, q) => p - q);
                for (let k = 0; k + 1 < xs.length; k += 2) {
                    const a = Math.max(0, xs[k]), b = Math.min(W, xs[k + 1]);
                    if (b <= a) continue;
                    const ia = Math.floor(a), ib = Math.floor(b);
                    minX = Math.min(minX, ia); maxX = Math.max(maxX, Math.min(W - 1, ib));
                    if (ia === ib) { cop[ia] += (b - a) / SOTTORIGHE; continue; }
                    cop[ia] += (ia + 1 - a) / SOTTORIGHE;
                    for (let px = ia + 1; px < ib; px++) cop[px] += 1 / SOTTORIGHE;
                    if (ib < W) cop[ib] += (b - ib) / SOTTORIGHE;
                }
            }
            if (maxX < 0) continue;
            const base = py * W * 4;
            for (let px = minX; px <= maxX; px++) {
                const c = cop[px];
                if (c > 0) this.fondi(base + px * 4, colore, Math.min(1, c));
                cop[px] = 0;
            }
        }
    }

    ellisse(x, y, w, h, colore) {
        this.poligono(puntiEllisse(x, y, w, h, 0, 360), colore);
    }

    // Spicchio come FillPie: angoli in gradi, in senso orario partendo dalle ore 3.
    spicchio(x, y, w, h, inizio, ampiezza, colore) {
        const punti = puntiEllisse(x, y, w, h, inizio, ampiezza);
        punti.push([x + w / 2, y + h / 2]);
        this.poligono(punti, colore);
    }
}

function puntiEllisse(x, y, w, h, inizio, ampiezza) {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    const passi = Math.max(12, Math.ceil(Math.PI * (rx + ry) / 3 * ampiezza / 360));
    const punti = [];
    const chiuso = ampiezza >= 360;
    for (let i = 0; i < (chiuso ? passi : passi + 1); i++) {
        const t = (inizio + ampiezza * i / passi) * Math.PI / 180;
        punti.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return punti;
}

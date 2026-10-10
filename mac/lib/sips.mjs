// Il ponte con 'sips', lo strumento per le immagini integrato in macOS.
// sips decodifica e codifica (JPEG, PNG, GIF, TIFF, HEIC...) passando per il BMP;
// tutto il resto (ridimensionare, descrivere, scrivere la fascia) è JavaScript.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leggiBMP, scriviBMP } from './immagine.js';

let disponibileCache = null;

export function sipsDisponibile() {
    if (disponibileCache === null) {
        try {
            execFileSync('sips', ['--help'], { stdio: 'ignore' });
            disponibileCache = true;
        } catch {
            disponibileCache = false;
        }
    }
    return disponibileCache;
}

function conCartella(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'oblio-sips-'));
    try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function sips(argomenti) {
    execFileSync('sips', argomenti, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
}

// Riconosce i formati dai primi byte (l'estensione può mentire).
export function formatoImmagine(dati) {
    const b = dati;
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    if (b.length > 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))) return 'tiff';
    return null;
}

export const TIPI_MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff' };

// Byte di un'immagine qualsiasi → { larghezza, altezza, dati RGBA }.
export function decodifica(dati) {
    const formato = formatoImmagine(dati);
    if (formato === 'bmp') {
        try { return leggiBMP(dati); } catch { /* proviamo con sips */ }
    }
    if (!sipsDisponibile()) throw new Error('per leggere le immagini serve sips (macOS)');
    return conCartella(dir => {
        const ingresso = join(dir, 'ingresso.' + (formato || 'img'));
        const uscita = join(dir, 'uscita.bmp');
        writeFileSync(ingresso, dati);
        try {
            sips(['-s', 'format', 'bmp', ingresso, '--out', uscita]);
        } catch {
            throw new Error('immagine non leggibile');
        }
        return leggiBMP(readFileSync(uscita));
    });
}

export function codificaJpeg(img, qualita = 85) {
    if (!sipsDisponibile()) throw new Error('per scrivere JPEG serve sips (macOS)');
    return conCartella(dir => {
        const ingresso = join(dir, 'ingresso.bmp');
        const uscita = join(dir, 'uscita.jpg');
        writeFileSync(ingresso, scriviBMP(img));
        sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(qualita), ingresso, '--out', uscita]);
        return readFileSync(uscita);
    });
}

export function codificaPng(img) {
    if (!sipsDisponibile()) throw new Error('per scrivere PNG serve sips (macOS)');
    return conCartella(dir => {
        const ingresso = join(dir, 'ingresso.bmp');
        const uscita = join(dir, 'uscita.png');
        writeFileSync(ingresso, scriviBMP(img));
        sips(['-s', 'format', 'png', ingresso, '--out', uscita]);
        return readFileSync(uscita);
    });
}

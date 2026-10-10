// Testi: riassunto estrattivo locale (nessun servizio esterno)
// e riconoscimento dei documenti che non devono mai sbiadire.
// Modulo condiviso tra Node e browser: nessun import di node:*.

const PAROLE_VUOTE = `
il lo la gli le un uno una di da in con su per tra fra ed ma che chi non si mi ti ci vi ne
del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle
sul sullo sulla sui sugli sulle col come anche più piu poi se perché perche quando questo questa questi queste quello quella
quelli quelle sono sei siamo siete era erano ero sarà ho hai ha abbiamo avete hanno avevo aveva avere essere stato stata stati
molto molta molti tutto tutta tutti tutte ogni mio mia miei mie tuo tua suo sua suoi sue nostro nostra loro io tu lui lei noi voi
cosa già gia ancora solo sempre mai dove qui qua lì là fino dopo prima mentre però pero quindi allora così cosi tanto poco
nessuno nessuna niente nulla qualche qualcosa altro altra altri altre stesso stessa quale quali ecco
the and of to is it that for on with as was are be this by or at from an but not have has had we you they he she
my our your their its so if do did can will would just than then there what which who how all also into out up about more no
`;
export const STOP = new Set(PAROLE_VUOTE.split(/\s+/).filter(Boolean));

// \W e \b di .NET sono Unicode: qui li riproduciamo con le classi \p{...}.
const NON_PAROLA = '[^\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]';
const PAROLA = '[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]';

// Documenti che non devono mai sbiadire, riconosciuti dal nome o dal contenuto.
export const NOMI_LEGALI = new RegExp(
    `(fattur|scontrin|ricevut|contratt|garanzi|bollett|rogito|polizz|cedolin|busta.?paga)|(^|${NON_PAROLA}|_)(f24|730|cud)(${NON_PAROLA}|_|$)`,
    'iu');
export const TESTO_LEGALE = new RegExp(
    `fattura\\s*(n\\.?|nr\\.?|num)|partita\\s*iva|p\\.\\s*iva|(?<!${PAROLA})iban(?!${PAROLA})|totale\\s+da\\s+pagare|codice\\s+fiscale`,
    'iu');

export function motivoFissato(nomeBase, testo) {
    if (NOMI_LEGALI.test(nomeBase)) return 'valore legale (nome)';
    if (testo && TESTO_LEGALE.test(testo)) return 'valore legale (contenuto)';
    return '';
}

// Windows-1252 scritto a mano: non tutte le versioni di Node la decodificano bene.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
export function decodificaCp1252(byte) {
    let s = '';
    for (const c of byte) s += c >= 0x80 && c < 0xa0 ? CP1252[c - 0x80] : String.fromCharCode(c);
    return s;
}

// UTF-8 rigoroso; se non lo è, la codifica "di sistema" di Windows (cp1252).
export function leggiTesto(dati) {
    const byte = dati instanceof Uint8Array ? dati : new Uint8Array(dati);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(byte).replace(/^﻿+/, '');
    } catch {
        return decodificaCp1252(byte);
    }
}

const RE_PAROLE = /[\p{L}\p{N}]+/gu;
const SOLO_CIFRE = /^\p{Nd}+$/u;

function confrontaTesto(a, b) {
    const x = a.localeCompare(b, 'it', { sensitivity: 'base' });
    return x !== 0 ? x : (a < b ? -1 : a > b ? 1 : 0);
}

export function analisiTesto(testo) {
    const pulito = String(testo).replace(/\r/g, '').trim();
    const frasi = pulito.split(/(?<=[.!?…])\s+|\n+/u).map(f => f.trim()).filter(Boolean);
    const tutte = pulito.toLowerCase().match(RE_PAROLE) || [];
    const freq = new Map();
    for (const w of tutte) {
        if (w.length > 2 && !STOP.has(w) && !SOLO_CIFRE.test(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
    let maxF = 1;
    if (freq.size) maxF = Math.max(...freq.values());

    const punteggi = frasi.map((frase, i) => {
        const parole = (frase.toLowerCase().match(RE_PAROLE) || []).filter(w => freq.has(w));
        let punti = 0;
        for (const w of new Set(parole)) punti += freq.get(w) / maxF;
        if (parole.length) punti = punti / Math.sqrt(parole.length);
        if (i === 0) punti *= 1.15;
        return { i, punti };
    });

    const chiave = [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || confrontaTesto(a[0], b[0]))
        .slice(0, 6)
        .map(e => e[0]);
    const quante = Math.trunc(Math.min(12, Math.max(1, Math.ceil(frasi.length * 0.3))));
    const perPunti = [...punteggi].sort((a, b) => b.punti - a.punti || a.i - b.i);
    const scelte = perPunti.slice(0, quante).sort((a, b) => a.i - b.i);
    const migliore = perPunti[0];

    return {
        parole: tutte.length,
        frasi: frasi.length,
        chiave,
        riassunto: scelte.map(s => frasi[s.i]).join(' '),
        frasiRiassunto: scelte.length,
        essenza: migliore ? frasi[migliore.i] : '',
    };
}

// Il contenuto dello strato "essenza": una frase e le parole chiave.
export function testoEssenza(a) {
    return `${a.essenza}\r\n\r\nParole chiave: ${a.chiave.join(', ')}`;
}

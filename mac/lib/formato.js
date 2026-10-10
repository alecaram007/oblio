// Formattazione all'italiana: numeri, byte, date, nomi accorciati.
// Modulo condiviso tra Node e browser: nessun import di node:*.

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const GIORNO_MS = 86400000;

// Arrotondamento "del banchiere" (metà al pari), come [Math]::Round e il cast [int] di .NET.
export function arrotondaPari(x) {
    const r = Math.round(x);
    if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
    return r;
}

// Arrotondamento lontano dallo zero, come i formati numerici di .NET (N0, N1, 0.00).
function arrotondaVia(x, decimali) {
    const f = 10 ** decimali;
    const v = Math.abs(x) * f;
    const r = Math.floor(v + 0.5 + 1e-9);
    return Math.sign(x) * r / f;
}

// Numero con separatore delle migliaia "." e decimali "," (formato N di it-IT).
export function numero(x, decimali = 0) {
    const r = arrotondaVia(x, decimali);
    const negativo = r < 0;
    const [intero, frazione] = Math.abs(r).toFixed(decimali).split('.');
    const gruppi = intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (negativo ? '-' : '') + gruppi + (frazione ? ',' + frazione : '');
}

// Due decimali senza migliaia (formato '0.00' di it-IT).
export function decimali2(x) {
    const r = arrotondaVia(x, 2);
    return r.toFixed(2).replace('.', ',');
}

export function formatByte(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return `${numero(n / 1048576, 1)} MB`;
    if (n >= 1024) return `${numero(n / 1024, 0)} KB`;
    return `${arrotondaPari(n)} B`;
}

// 'd MMM yyyy' in italiano, nell'ora locale ('yyyy' di .NET ha sempre quattro cifre: anno 110 → "0110").
export function formatData(d) {
    const data = d instanceof Date ? d : new Date(d);
    return `${data.getDate()} ${MESI[data.getMonth()]} ${String(data.getFullYear()).padStart(4, '0')}`;
}

export function formatNome(n, max = 24) {
    n = String(n);
    if (n.length <= max) return n;
    return n.substring(0, max - 1) + '…';
}

// Allineamenti come {0,-24} e {0,3} dei formati .NET.
export function aSinistra(s, n) { return String(s).padEnd(n, ' '); }
export function aDestra(s, n) { return String(s).padStart(n, ' '); }

// Data ISO 8601 in UTC con sette cifre decimali, come DateTime.ToString('o').
export function isoOra(d) {
    const s = (d instanceof Date ? d : new Date(d)).toISOString();
    return s.replace(/\.(\d{3})Z$/, '.$10000Z');
}

// Legge una data salvata (ISO, con o senza fuso). Senza fuso vale l'ora locale, come in .NET.
export function leggiData(valore) {
    if (valore instanceof Date) return valore;
    const d = new Date(String(valore));
    if (Number.isNaN(d.getTime())) throw new Error(`Data non valida: '${valore}'`);
    return d;
}

export function contieneSenzaMaiuscole(testo, cosa) {
    if (!testo || cosa == null) return false;
    // NFC: sul Mac i nomi dei file arrivano spesso decomposti ("a" + accento), il terminale li scrive composti
    return String(testo).normalize('NFC').toLowerCase().includes(String(cosa).normalize('NFC').toLowerCase());
}

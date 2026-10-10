// Novità rispetto alla versione Windows: testo estratto da PDF semplici,
// documenti Word (.docx) e OpenDocument (.odt), così anche loro possono
// sbiadire per gradi (riassunto, essenza) invece di passare subito alla traccia.
// Niente librerie: il .docx è uno zip, che apriamo con zlib di Node;
// il PDF lo leggiamo a mano, flussi compressi compresi.

import { inflateRawSync, inflateSync } from 'node:zlib';
import { decodificaCp1252 } from './testo.js';

export const EST_DOCUMENTI = ['.pdf', '.docx', '.odt'];

// ---------------------------------------------------------------------------
// ZIP (.docx, .odt)
// ---------------------------------------------------------------------------
export function leggiZip(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let fineDir = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
        if (b.readUInt32LE(i) === 0x06054b50) { fineDir = i; break; }
    }
    if (fineDir < 0) throw new Error('non è un archivio zip');
    const voci = b.readUInt16LE(fineDir + 10);
    let p = b.readUInt32LE(fineDir + 16);
    const file = new Map();
    for (let k = 0; k < voci; k++) {
        if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('zip rovinato');
        const metodo = b.readUInt16LE(p + 10);
        const compresso = b.readUInt32LE(p + 20);
        const lunNome = b.readUInt16LE(p + 28), lunExtra = b.readUInt16LE(p + 30), lunCommento = b.readUInt16LE(p + 32);
        const locale = b.readUInt32LE(p + 42);
        const nome = b.subarray(p + 46, p + 46 + lunNome).toString('utf8');
        file.set(nome, { metodo, compresso, locale });
        p += 46 + lunNome + lunExtra + lunCommento;
    }
    return {
        nomi: [...file.keys()],
        leggi(nome) {
            const f = file.get(nome);
            if (!f) return null;
            const l = f.locale;
            const inizio = l + 30 + b.readUInt16LE(l + 26) + b.readUInt16LE(l + 28);
            const dati = b.subarray(inizio, inizio + f.compresso);
            if (f.metodo === 0) return Buffer.from(dati);
            if (f.metodo === 8) return inflateRawSync(dati);
            throw new Error('compressione zip non gestita');
        },
    };
}

const ENTITA = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodificaEntita(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] === '#') {
            const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENTITA[e.toLowerCase()] ?? m;
    });
}

function testoDaXml(xml, finePara, tab, aCapo) {
    return decodificaEntita(xml
        .replace(finePara, '\n')
        .replace(tab, '\t')
        .replace(aCapo, '\n')
        .replace(/<[^>]*>/g, ''))
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function testoDocx(buf) {
    const zip = leggiZip(buf);
    const xml = zip.leggi('word/document.xml');
    if (!xml) throw new Error('documento Word senza testo');
    return testoDaXml(xml.toString('utf8'), /<\/w:p>/g, /<w:tab\/>/g, /<w:(br|cr)\/>/g);
}

export function testoOdt(buf) {
    const zip = leggiZip(buf);
    const xml = zip.leggi('content.xml');
    if (!xml) throw new Error('documento OpenDocument senza testo');
    return testoDaXml(xml.toString('utf8'), /<\/text:(p|h)>/g, /<text:tab\/>/g, /<text:line-break\/>/g);
}

// ---------------------------------------------------------------------------
// PDF semplici: testo nei flussi di contenuto (Tj, TJ, ', "), con le
// tabelle ToUnicode quando ci sono. Niente OCR: i PDF fatti di sole
// immagini (scansioni) restano binari.
// ---------------------------------------------------------------------------
function decomprimi(dati) {
    try { return inflateSync(dati); } catch { /* proviamo senza intestazione */ }
    try { return inflateRawSync(dati); } catch { /* ... */ }
    try { return inflateSync(dati, { finishFlush: 2 }); } catch { return null; }
}

function oggettiPdf(b) {
    const s = b.toString('latin1');
    const oggetti = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
        const id = +m[1];
        const inizio = m.index + m[0].length;
        let fine = s.indexOf('endobj', inizio);
        if (fine < 0) fine = s.length;
        let corpo = s.slice(inizio, fine);
        let flusso = null;
        const st = /\bstream\r?\n/.exec(corpo);
        if (st) {
            const dict = corpo.slice(0, st.index);
            const lun = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
            const da = inizio + st.index + st[0].length;
            let a = lun ? da + +lun[1] : -1;
            if (a < 0 || a > b.length || s.slice(a, a + 30).indexOf('endstream') < 0) {
                a = s.indexOf('endstream', da);
                while (a > da && (s[a - 1] === '\n' || s[a - 1] === '\r')) a--;
            }
            flusso = b.subarray(da, a);
            corpo = dict;
            if (/\/FlateDecode/.test(dict)) flusso = decomprimi(flusso);
            else if (/\/Filter/.test(dict)) flusso = null;  // altri filtri (immagini): non ci interessano
        }
        oggetti.set(id, { dict: corpo, flusso });
        re.lastIndex = fine;
    }
    // oggetti compressi dentro i flussi /ObjStm (PDF 1.5 e successivi)
    for (const o of [...oggetti.values()]) {
        if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.flusso) continue;
        const n = +(/\/N\s+(\d+)/.exec(o.dict)?.[1] || 0);
        const primo = +(/\/First\s+(\d+)/.exec(o.dict)?.[1] || 0);
        const testo = o.flusso.toString('latin1');
        const numeri = testo.slice(0, primo).trim().split(/\s+/).map(Number);
        // /N rovinato (o enorme) non deve far girare il ciclo per miliardi di volte
        const quanti = Math.min(n, Math.floor(numeri.length / 2));
        for (let i = 0; i < quanti; i++) {
            const id = numeri[2 * i], da = primo + numeri[2 * i + 1];
            const a = i + 1 < quanti ? primo + numeri[2 * i + 3] : testo.length;
            if (!oggetti.has(id)) oggetti.set(id, { dict: testo.slice(da, a), flusso: null });
        }
    }
    return oggetti;
}

function stringaHex(h) {
    h = h.replace(/[^0-9a-f]/gi, '');
    if (h.length % 2) h += '0';
    return Buffer.from(h, 'hex');
}

function tabellaUnicode(cmap) {
    const mappa = new Map();
    let byteCodice = 1;
    const spazio = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(cmap);
    if (spazio) byteCodice = Math.max(1, spazio[1].length / 2);
    const unicode = hex => {
        const b = stringaHex(hex);
        let s = '';
        for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
        return s;
    };
    for (const blocco of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const m of blocco[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
            mappa.set(parseInt(m[1], 16), unicode(m[2]));
            byteCodice = Math.max(byteCodice, Math.ceil(m[1].length / 2));
        }
    }
    for (const blocco of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const m of blocco[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
            const da = parseInt(m[1], 16), a = parseInt(m[2], 16);
            byteCodice = Math.max(byteCodice, Math.ceil(m[1].length / 2));
            if (a - da > 65535) continue;
            if (m[4] !== undefined) {
                const base = unicode(m[4]);
                const ultimo = base.charCodeAt(base.length - 1);
                for (let c = da; c <= a; c++) mappa.set(c, base.slice(0, -1) + String.fromCharCode(ultimo + c - da));
            } else {
                const lista = [...m[5].matchAll(/<([0-9a-f]+)>/gi)].map(x => unicode(x[1]));
                for (let c = da; c <= a && c - da < lista.length; c++) mappa.set(c, lista[c - da]);
            }
        }
    }
    return { mappa, byteCodice };
}

// Le due codifiche "semplici" più comuni nei PDF senza tabella ToUnicode.
export const MAC_ROMAN = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function decodificaStringa(byte, font) {
    if (font && font.mappa.size) {
        let s = '';
        const n = font.byteCodice;
        for (let i = 0; i + n <= byte.length; i += n) {
            let c = 0;
            for (let k = 0; k < n; k++) c = c * 256 + byte[i + k];
            s += font.mappa.get(c) ?? '';
        }
        return s;
    }
    if (font && font.codifica === 'mac') {
        let s = '';
        for (const c of byte) s += c < 128 ? String.fromCharCode(c) : MAC_ROMAN[c - 128];
        return s;
    }
    return decodificaCp1252(byte);
}

function leggiLetterale(s, i) {
    // s[i] === '('
    const out = [];
    let profondita = 1;
    i++;
    while (i < s.length && profondita > 0) {
        const c = s[i];
        if (c === '\\') {
            const d = s[i + 1];
            const sost = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
            if (d in sost) { out.push(sost[d]); i += 2; continue; }
            if (/[0-7]/.test(d)) {
                const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0];
                out.push(parseInt(m, 8) & 255); i += 1 + m.length; continue;
            }
            if (d === '\r' || d === '\n') { i += d === '\r' && s[i + 2] === '\n' ? 3 : 2; continue; }
            i++; continue;
        }
        if (c === '(') profondita++;
        if (c === ')') { profondita--; if (profondita === 0) { i++; break; } }
        out.push(c.charCodeAt(0) & 255);
        i++;
    }
    return [Buffer.from(out), i];
}

function testoContenuto(contenuto, fonts) {
    const s = contenuto.toString('latin1');
    let out = '';
    let font = null;
    const pila = [];
    let i = 0;
    const accoda = t => { out += t; };
    while (i < s.length) {
        const c = s[i];
        if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
        if (c === '(') { const [b, j] = leggiLetterale(s, i); pila.push({ str: b }); i = j; continue; }
        if (c === '<' && s[i + 1] !== '<') {
            let j = s.indexOf('>', i);
            if (j < 0) j = s.length;   // PDF troncato: senza questo si ricominciava da capo all'infinito
            pila.push({ str: stringaHex(s.slice(i + 1, j)) }); i = j + 1; continue;
        }
        if (c === '[') { pila.push({ inizioArray: true }); i++; continue; }
        if (c === ']') {
            const elementi = [];
            while (pila.length && !pila[pila.length - 1].inizioArray) elementi.unshift(pila.pop());
            pila.pop();
            pila.push({ array: elementi });
            i++; continue;
        }
        if (/\s/.test(c)) { i++; continue; }
        const m = /^(\/[^\s/\[\]()<>{}%]+|[+-]?(\d+\.?\d*|\.\d+)|[A-Za-z'"*]+|<<|>>|[{}])/.exec(s.slice(i, i + 64));
        if (!m) { i++; continue; }
        const tok = m[0];
        i += tok.length;
        if (tok[0] === '/') { pila.push({ nome: tok.slice(1) }); continue; }
        if (/^[+-]?(\d|\.)/.test(tok)) { pila.push({ num: parseFloat(tok) }); continue; }
        switch (tok) {
            case 'Tf': { const nome = pila[pila.length - 2]?.nome; font = fonts.get(nome) || null; break; }
            case 'Tj': { const t = pila[pila.length - 1]; if (t?.str) accoda(decodificaStringa(t.str, font)); break; }
            case "'": case '"': { const t = pila[pila.length - 1]; accoda('\n'); if (t?.str) accoda(decodificaStringa(t.str, font)); break; }
            case 'TJ': {
                const a = pila[pila.length - 1]?.array || [];
                for (const e of a) {
                    if (e.str) accoda(decodificaStringa(e.str, font));
                    else if (e.num !== undefined && e.num < -180) accoda(' ');
                }
                break;
            }
            case 'T*': accoda('\n'); break;
            case 'Td': case 'TD': {
                const ty = pila[pila.length - 1]?.num ?? 0, tx = pila[pila.length - 2]?.num ?? 0;
                if (ty !== 0) accoda('\n'); else if (tx > 0 && !/\s$/.test(out)) accoda(' ');
                break;
            }
            case 'Tm': accoda('\n'); break;
            case 'ET': accoda('\n'); break;
            default: break;
        }
        if (/^[A-Za-z'"*]+$/.test(tok)) pila.length = 0;
    }
    return out;
}

export function testoPdf(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (b.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('non è un PDF');
    const oggetti = oggettiPdf(b);
    // nome della risorsa font (/F1) → tabella ToUnicode
    const fonts = new Map();
    const tabelle = new Map();
    for (const o of oggetti.values()) {
        for (const m of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
            for (const r of m[1].matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
                const fontObj = oggetti.get(+r[2]);
                if (!fontObj) continue;
                let dict = fontObj.dict;
                const enc = /\/Encoding\s+(\d+)\s+\d+\s+R/.exec(dict);
                if (enc) dict += oggetti.get(+enc[1])?.dict || '';
                const codifica = /MacRomanEncoding/.test(dict) ? 'mac' : 'win';
                const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObj.dict);
                let tabella = null;
                if (tu) {
                    if (!tabelle.has(+tu[1])) {
                        const cmap = oggetti.get(+tu[1])?.flusso;
                        tabelle.set(+tu[1], cmap ? tabellaUnicode(cmap.toString('latin1')) : null);
                    }
                    tabella = tabelle.get(+tu[1]);
                }
                fonts.set(r[1], { mappa: tabella?.mappa || new Map(), byteCodice: tabella?.byteCodice || 1, codifica });
            }
        }
    }
    // flussi di contenuto delle pagine, nell'ordine in cui compaiono
    const contenuti = [];
    for (const o of oggetti.values()) {
        if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;
        const c = /\/Contents\s*(\[([^\]]*)\]|(\d+)\s+\d+\s+R)/.exec(o.dict);
        if (!c) continue;
        const rif = c[2] ? [...c[2].matchAll(/(\d+)\s+\d+\s+R/g)].map(x => +x[1]) : [+c[3]];
        for (const id of rif) { const f = oggetti.get(id)?.flusso; if (f) contenuti.push(f); }
    }
    const testo = contenuti.map(c => testoContenuto(c, fonts)).join('\n');
    return testo.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// Restituisce il testo, oppure null se il documento non ne contiene di leggibile.
export function estraiTesto(dati, estensione) {
    let testo = null;
    try {
        const e = String(estensione).toLowerCase();
        if (e === '.pdf') testo = testoPdf(dati);
        else if (e === '.docx') testo = testoDocx(dati);
        else if (e === '.odt') testo = testoOdt(dati);
    } catch {
        return null;
    }
    if (!testo) return null;
    // Se è soprattutto spazzatura (glifi senza tabella), meglio trattarlo come binario.
    const lettere = (testo.match(/[\p{L}\p{N}]/gu) || []).length;
    const parole = (testo.match(/[\p{L}\p{N}]+/gu) || []).length;
    const stampabili = (testo.match(/[\p{L}\p{N}\p{P}\p{Zs}\n\t€$%+=<>|~^`]/gu) || []).length;
    if (parole < 3 || lettere < 10 || stampabili / testo.length < 0.9) return null;
    return testo;
}

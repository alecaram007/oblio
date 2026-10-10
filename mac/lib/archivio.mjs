// OBLIO - il file system che dimentica come un essere umano.
// Il nucleo per Node: lo usano sia la riga di comando sia il server web.
//
// Ogni file viene salvato a strati di dettaglio decrescente, ciascuno cifrato
// con una chiave diversa. Col passare del tempo senza aperture la vitalità
// del file cala (curva dell'oblio di Ebbinghaus) e le chiavi degli strati più
// dettagliati vengono distrutte: il file sbiadisce, fino a restare una traccia.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import {
    formatByte, formatData, formatNome, aSinistra, aDestra, numero, decimali2,
    isoOra, leggiData, arrotondaPari, contieneSenzaMaiuscole,
} from './formato.js';
import {
    STABILITA_BASE, RIPASSO, STABILITA_MAX, VELOCITA, ORDINE_STATI, PLURALI,
    oggi as oggiDi, fattore as fattoreDi, vitalita, stratiVivi, statoVoce, giorniAlProssimo,
    tabellaVelocita, anteprimaDomani,
} from './modello.js';
import { analisiTesto, testoEssenza, leggiTesto, motivoFissato } from './testo.js';
import { lato, ridimensiona, descrizioneImmagine, aggiungiFiligrana } from './immagine.js';
import { dataScatto } from './exif.js';
import { nuovaChiave, proteggiStrato, sproteggiStrato } from './cifra.mjs';
import { decodifica, codificaJpeg, formatoImmagine, TIPI_MIME } from './sips.mjs';
import { estraiTesto, EST_DOCUMENTI } from './estrai.mjs';

export const EST_IMMAGINI = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff'];
export const EST_TESTI = ['.txt', '.md', '.log', '.csv'];
export const TIPI_NOTI = {
    '.pdf': 'Documento PDF', '.doc': 'Documento Word', '.docx': 'Documento Word',
    '.xls': 'Foglio Excel', '.xlsx': 'Foglio Excel', '.ppt': 'Presentazione', '.pptx': 'Presentazione',
    '.zip': 'Archivio compresso', '.rar': 'Archivio compresso', '.7z': 'Archivio compresso',
    '.mp3': 'Audio', '.wav': 'Audio', '.m4a': 'Audio', '.mp4': 'Video', '.mov': 'Video', '.mkv': 'Video',
    '.exe': 'Programma', '.bin': 'Dati binari',
    '.odt': 'Documento OpenDocument',
};

export class ErroreOblio extends Error { }
const errore = msg => new ErroreOblio(msg);

// Gli errori del disco arrivano da Node in inglese ("EACCES: permission denied, open ...");
// su un Windows italiano .NET li diceva in italiano: diciamoli come lui.
export function messaggioErrore(e) {
    if (!e || e instanceof ErroreOblio || typeof e.code !== 'string') return e?.message ?? String(e);
    const dove = e.path ? ` '${e.path}'` : '';
    switch (e.code) {
        case 'EACCES': case 'EPERM': return `Accesso al percorso${dove} negato.`;
        case 'ENOENT': return `Impossibile trovare il file${dove}.`;
        case 'ENOTDIR': return `Impossibile trovare una parte del percorso${dove}.`;
        case 'EISDIR': return `Il percorso${dove} è una cartella, non un file.`;
        case 'ENOSPC': return 'Spazio insufficiente sul disco.';
        case 'EROFS': return `Il percorso${dove} è su un disco di sola lettura.`;
        default: return e.message;
    }
}

// ---------------------------------------------------------------------------
// Uscita: le righe che la versione Windows stampava con Write-Host.
// La riga di comando le stampa subito, il server le raccoglie per la pagina.
// ---------------------------------------------------------------------------
export class Uscita {
    constructor(scrivi = null) { this.righe = []; this.scrivi = scrivi; }
    riga(testo = '', colore = null) {
        this.righe.push({ testo, colore });
        if (this.scrivi) this.scrivi(testo, colore);
    }
}

// ---------------------------------------------------------------------------
// Archivio su disco
// ---------------------------------------------------------------------------
export function percorsi(radice) {
    const meta = path.join(radice, '.oblio');
    return {
        radice,
        meta,
        stato: path.join(meta, 'stato.json'),
        chiavi: path.join(meta, 'chiavi.json'),
        strati: path.join(meta, 'strati'),
        ricordi: path.join(radice, 'ricordi'),
    };
}

export function risolviRadice(archivio, env = process.env, cwd = process.cwd()) {
    let radice = archivio || env.OBLIO_ARCHIVIO || 'archivio-oblio';
    if (radice === '~' || radice.startsWith('~/')) radice = path.join(env.HOME || '', radice.slice(1));
    return path.resolve(cwd, radice);
}

function scriviAtomico(percorso, testo) {
    const tmp = `${percorso}.tmp`;
    fs.writeFileSync(tmp, testo, 'utf8');
    fs.renameSync(tmp, percorso);
}

function leggiJson(percorso) {
    const testo = fs.readFileSync(percorso, 'utf8').replace(/^﻿/, '');
    try {
        return JSON.parse(testo);
    } catch {
        // il messaggio di JSON.parse è in inglese e non dice quale file
        throw errore(`Il file '${percorso}' è rovinato: non è JSON valido.`);
    }
}

export function esisteArchivio(P) { return fs.existsSync(P.stato); }

export function leggiStato(P) {
    if (!fs.existsSync(P.stato)) {
        throw errore(`Nessun archivio Oblio in '${P.radice}'. Crealo con:  oblio crea`);
    }
    const stato = leggiJson(P.stato);
    if (!stato || typeof stato !== 'object' || Array.isArray(stato)) {
        throw errore(`Il file '${P.stato}' è rovinato: non contiene lo stato di un archivio.`);
    }
    for (const [campo, valore] of Object.entries({ offsetGiorni: 0, velocita: 'normale', dimenticatiPerSempre: 0 })) {
        if (!(campo in stato)) stato[campo] = valore;
    }
    // PowerShell scrive un array di un solo elemento come oggetto singolo: rimettiamo le cose a posto.
    const comeLista = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
    stato.voci = comeLista(stato.voci).filter(Boolean);
    for (const v of stato.voci) v.strati = comeLista(v.strati).filter(Boolean);
    return stato;
}

export function salvaStato(P, stato) {
    scriviAtomico(P.stato, JSON.stringify(stato, null, 4));
}

// In un sistema vero le chiavi vivrebbero nel Secure Enclave del Mac:
// lì distruggerle è definitivo. Qui stanno in un file, per semplicità.
export function leggiChiavi(P) {
    const chiavi = new Map();
    if (fs.existsSync(P.chiavi)) {
        const o = leggiJson(P.chiavi);
        for (const [k, v] of Object.entries(o || {})) chiavi.set(k, Buffer.from(String(v), 'base64'));
    }
    return chiavi;
}

export function salvaChiavi(P, chiavi) {
    const o = {};
    for (const k of [...chiavi.keys()].sort()) o[k] = chiavi.get(k).toString('base64');
    scriviAtomico(P.chiavi, JSON.stringify(o, null, 4));
}

export function creaArchivio(P, uscita) {
    if (fs.existsSync(P.stato)) {
        uscita.riga(`  Esiste già un archivio Oblio in ${P.radice}.`);
        return false;
    }
    for (const d of [P.meta, P.strati, P.ricordi]) fs.mkdirSync(d, { recursive: true });
    const stato = {
        versione: 1,
        creato: isoOra(new Date()),
        offsetGiorni: 0,
        velocita: 'normale',
        dimenticatiPerSempre: 0,
        voci: [],
    };
    salvaChiavi(P, new Map());
    salvaStato(P, stato);
    uscita.riga('');
    uscita.riga(`  Archivio Oblio creato in ${P.radice}`, 'White');
    uscita.riga('  Da qui in poi, ciò che non riapri sbiadisce. Aggiungi file con:  oblio aggiungi <file|cartella>', 'DarkGray');
    return true;
}

// Un contesto di lavoro: percorsi, stato e chiavi in memoria, dove scrivere.
export function apriContesto(radice, uscita = new Uscita()) {
    const P = percorsi(radice);
    const stato = leggiStato(P);
    const chiavi = leggiChiavi(P);
    return { P, stato, chiavi, uscita, ora: () => Date.now() };
}

export function salva(ctx) {
    salvaChiavi(ctx.P, ctx.chiavi);
    salvaStato(ctx.P, ctx.stato);
}

// ---------------------------------------------------------------------------
// Strati cifrati
// ---------------------------------------------------------------------------
export function percorsoStrato(P, v, s) {
    return path.join(P.strati, v.id, `${s.nome}.bin`);
}

export function leggiStrato(ctx, v, s) {
    const id = `${v.id}/${s.nome}`;
    const blob = percorsoStrato(ctx.P, v, s);
    if (!ctx.chiavi.has(id)) throw new Error('chiave distrutta');
    if (!fs.existsSync(blob)) throw new Error('strato mancante');
    return sproteggiStrato(fs.readFileSync(blob), ctx.chiavi.get(id));
}

// Dimenticare = distruggere la chiave. Senza chiave lo strato è rumore,
// anche se ne esistesse una copia in un backup. Il file cifrato viene
// comunque rimosso per liberare spazio.
export function rimuoviStrato(ctx, v, s) {
    const id = `${v.id}/${s.nome}`;
    if (ctx.chiavi.has(id)) {
        ctx.chiavi.get(id).fill(0);
        ctx.chiavi.delete(id);
    }
    const blob = percorsoStrato(ctx.P, v, s);
    if (fs.existsSync(blob)) fs.rmSync(blob, { force: true });
    s.vivo = false;
}

// ---------------------------------------------------------------------------
// Vitalità e oblio
// ---------------------------------------------------------------------------
export const oggi = ctx => oggiDi(ctx.stato, ctx.ora());
export const fattore = ctx => fattoreDi(ctx.stato);

export function invocaOblio(ctx) {
    const adesso = oggi(ctx);
    const f = fattore(ctx);
    const eventi = [];
    for (const v of ctx.stato.voci) {
        if (v.fissato) continue;
        const R = vitalita(v, adesso, f);
        const persi = [];
        for (const s of stratiVivi(v)) {
            if (R < Number(s.soglia)) {
                rimuoviStrato(ctx, v, s);
                s.dimenticatoIl = isoOra(adesso);
                const peso = formatByte(s.byte);
                if (s.dettaglio === peso) persi.push(`${s.nome} (${peso})`);
                else persi.push(`${s.nome} (${s.dettaglio}, ${peso})`);
            }
        }
        if (persi.length) eventi.push({ id: v.id, nome: v.nome, persi, ora: statoVoce(v) });
    }
    return eventi;
}

export function mostraEventi(uscita, eventi, perTempo) {
    uscita.riga('');
    const titolo = perTempo ? '  In questo tempo Oblio ha dimenticato:' : '  Da quando non ci vedevamo, Oblio ha dimenticato:';
    uscita.riga(titolo, 'Cyan');
    for (const e of eventi) {
        uscita.riga(`    ${aSinistra(formatNome(e.nome), 24)} → ${aSinistra(e.ora, 9)} persi: ${e.persi.join('; ')}`, 'Cyan');
    }
}

// ---------------------------------------------------------------------------
// Aggiungere file: ogni file diventa una pila di strati cifrati
// ---------------------------------------------------------------------------
export function tipoDa(est) {
    const e = String(est).toLowerCase();
    if (EST_IMMAGINI.includes(e)) return 'immagine';
    if (EST_TESTI.includes(e)) return 'testo';
    return 'binario';
}

// Come Path.GetExtension di .NET: ".bashrc" ha estensione ".bashrc".
export function estensione(nome) {
    const i = nome.lastIndexOf('.');
    return i < 0 ? '' : nome.slice(i);
}
export function nomeBase(nome) {
    const i = nome.lastIndexOf('.');
    return i < 0 ? nome : nome.slice(0, i);
}

export function nomeLibero(stato, nome) {
    const esistenti = new Set(stato.voci.map(v => String(v.nome).normalize('NFC').toLowerCase()));
    if (!esistenti.has(nome.normalize('NFC').toLowerCase())) return nome;
    const base = nomeBase(nome), est = estensione(nome);
    for (let i = 2; ; i++) {
        const candidato = `${base} (${i})${est}`;
        if (!esistenti.has(candidato.normalize('NFC').toLowerCase())) return candidato;
    }
}

export function aggiungiFile(ctx, percorsoFile) {
    const info = fs.statSync(percorsoFile);
    // come File.ReadAllBytes di .NET (e readFileSync di Node, che però lo dice in inglese)
    if (info.size > 2147483647) throw errore('Il file è troppo lungo. Questa operazione è attualmente limitata al supporto di file di dimensioni inferiori a 2 GB.');
    const bytes = fs.readFileSync(percorsoFile);
    const modificato = info.mtime;
    // NFC come su Windows: "città.txt" scritto nel terminale deve trovare il file anche se il Mac lo chiama "citta\u0300.txt"
    const nome = path.basename(percorsoFile).normalize('NFC');
    const est = estensione(nome);
    let tipo = tipoDa(est);
    const strati = [];
    let descrizione = '', larghezza = 0, altezza = 0, testoLegale = '';

    if (tipo === 'immagine') {
        try {
            const img = decodifica(bytes);
            descrizione = descrizioneImmagine(img, dataScatto(bytes) || modificato);
            for (const [nomeStrato, soglia, max, qualita] of [['miniatura', 0.05, 64, 80], ['media', 0.2, 480, 85]]) {
                const [w, h] = lato(img.larghezza, img.altezza, max);
                strati.push({ nome: nomeStrato, soglia, dettaglio: `${w}×${h} px`, dati: codificaJpeg(ridimensiona(img, w, h), qualita) });
            }
            strati.push({ nome: 'originale', soglia: 0.5, dettaglio: `${img.larghezza}×${img.altezza} px`, dati: bytes });
            larghezza = img.larghezza; altezza = img.altezza;
        } catch {
            tipo = 'binario';
            strati.length = 0;
        }
    }

    // Novità: PDF, .docx e .odt con testo leggibile sbiadiscono come i testi.
    let testoDocumento = null;
    if (tipo === 'binario' && EST_DOCUMENTI.includes(est.toLowerCase())) {
        testoDocumento = estraiTesto(bytes, est);
        if (testoDocumento) tipo = 'testo';
    }

    if (tipo === 'testo') {
        const testo = testoDocumento ?? leggiTesto(bytes);
        const a = analisiTesto(testo);
        testoLegale = testo;
        const temi = a.chiave.slice(0, 3).join(', ');
        const genere = testoDocumento ? TIPI_NOTI[est.toLowerCase()] : 'Testo';
        if (a.parole) descrizione = `${genere} di ${a.parole} parole, ${a.frasi} frasi; parla di: ${temi} · ${formatData(modificato)}`;
        else descrizione = `${testoDocumento ? genere + ' senza testo' : 'Testo vuoto'} · ${formatData(modificato)}`;
        strati.push({ nome: 'essenza', soglia: 0.05, dettaglio: '1 frase + parole chiave', dati: Buffer.from(testoEssenza(a), 'utf8') });
        strati.push({ nome: 'riassunto', soglia: 0.2, dettaglio: `${a.frasiRiassunto} frasi su ${a.frasi}`, dati: Buffer.from(a.riassunto, 'utf8') });
        strati.push({ nome: 'originale', soglia: 0.5, dettaglio: `${a.parole} parole`, dati: bytes });
    }

    if (tipo === 'binario') {
        const genere = TIPI_NOTI[est.toLowerCase()] || `File ${est}`;
        const impronta = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
        descrizione = `${genere} di ${formatByte(bytes.length)} · impronta ${impronta}… · ${formatData(modificato)}`;
        // un file binario non sa sbiadire a metà: resiste di più, poi resta solo la traccia
        strati.push({ nome: 'originale', soglia: 0.2, dettaglio: formatByte(bytes.length), dati: bytes });
    }

    const motivo = motivoFissato(nomeBase(nome), testoLegale);

    const id = randomUUID().replace(/-/g, '').slice(0, 10);
    const cartella = path.join(ctx.P.strati, id);
    fs.mkdirSync(cartella, { recursive: true });
    const ora = isoOra(oggi(ctx));
    const voceStrati = [];
    for (const s of strati) {
        const k = nuovaChiave();
        fs.writeFileSync(path.join(cartella, `${s.nome}.bin`), proteggiStrato(s.dati, k));
        ctx.chiavi.set(`${id}/${s.nome}`, k);
        voceStrati.push({ nome: s.nome, soglia: s.soglia, dettaglio: s.dettaglio, byte: s.dati.length, vivo: true, dimenticatoIl: null });
    }

    const voce = {
        id,
        nome: nomeLibero(ctx.stato, nome),
        tipo,
        descrizione,
        byteOriginali: bytes.length,
        larghezza,
        altezza,
        aggiunto: ora,
        ultimoAccesso: ora,
        stabilita: STABILITA_BASE,
        accessi: 0,
        fissato: Boolean(motivo),
        motivoFissato: motivo,
        strati: voceStrati,
    };
    ctx.stato.voci.push(voce);
    return voce;
}

// I file nascosti (che iniziano con un punto, come .DS_Store) restano fuori,
// come faceva Get-ChildItem su Windows con i file nascosti.
// Per confrontare percorsi come fa il Mac: maiuscole e forma degli accenti (NFC/NFD) non contano.
const chiavePercorso = p => p.normalize('NFC').toLowerCase();
const percorsoVero = p => { try { return fs.realpathSync(p); } catch { return p; } };

function elencaFile(cartella, escludi) {
    const voci = fs.readdirSync(cartella, { withFileTypes: true })
        .filter(d => !d.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const file = [], sotto = [];
    for (const d of voci) {
        const p = path.join(cartella, d.name);
        if (chiavePercorso(p + path.sep).startsWith(chiavePercorso(escludi))) continue;
        if (d.isDirectory()) sotto.push(p);
        else if (d.isFile()) file.push(p);
        // un collegamento simbolico a un file conta come il file (Get-ChildItem -File lo elencava);
        // i collegamenti a cartelle no, per non girare in tondo
        else if (d.isSymbolicLink()) { try { if (fs.statSync(p).isFile()) file.push(p); } catch { /* collegamento rotto */ } }
    }
    for (const s of sotto) file.push(...elencaFile(s, escludi));
    return file;
}

export function aggiungiPercorso(ctx, percorso, { sposta = false } = {}) {
    const { uscita } = ctx;
    if (!percorso) throw errore('Indica un file o una cartella:  oblio aggiungi <percorso>');
    const pieno = path.resolve(percorso);
    if (!fs.existsSync(pieno)) throw errore(`Non trovo '${percorso}'.`);
    // i file dell'archivio stesso (per esempio i ricordi) non vanno riaggiunti, anche se il
    // percorso arriva scritto in un'altra forma (/tmp invece di /private/tmp, accenti NFD)
    const dentroArchivio = percorsoVero(ctx.P.radice).replace(/\/+$/, '') + path.sep;
    const files = fs.statSync(pieno).isDirectory() ? elencaFile(percorsoVero(pieno), dentroArchivio) : [pieno];
    const aggiunte = [];
    if (!files.length) { uscita.riga('  Nessun file da aggiungere.'); return aggiunte; }

    uscita.riga('');
    let ok = 0;
    for (const file of files) {
        try {
            const v = aggiungiFile(ctx, file);
            // salva prima di toccare l'originale: se qualcosa va storto, niente è perso
            salva(ctx);
            if (sposta) fs.rmSync(file, { force: true });
            ok++;
            aggiunte.push(v);
            let extra = '', colore = 'White';
            if (v.fissato) { extra = ` · fissato: ${v.motivoFissato}`; colore = 'Yellow'; }
            uscita.riga(`  + ${aSinistra(formatNome(v.nome), 24)} ${aSinistra(v.tipo, 9)} ${v.strati.length} strati · ${formatByte(v.byteOriginali)}${extra}`, colore);
        } catch (e) {
            uscita.riga(`  ! ${path.basename(file)}: ${messaggioErrore(e)}`, 'Red');
        }
    }
    uscita.riga('');
    uscita.riga(`  ${ok} file affidati all'oblio.`, 'White');
    if (!sposta) {
        uscita.riga("  Gli originali sono rimasti dove erano (usa -Sposta per spostarli davvero nell'archivio).", 'DarkGray');
    }
    return aggiunte;
}

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------
export function trovaVoce(stato, chi) {
    if (!chi) throw errore('Indica il nome di un file.');
    const voci = stato.voci;
    const chiMin = String(chi).normalize('NFC').toLowerCase();
    let trovate = voci.filter(v => String(v.nome).normalize('NFC').toLowerCase() === chiMin || String(v.id).toLowerCase() === chiMin);
    if (trovate.length === 1) return trovate[0];
    trovate = voci.filter(v => contieneSenzaMaiuscole(v.nome, chi));
    if (trovate.length === 1) return trovate[0];
    if (trovate.length > 1) throw errore(`Più file corrispondono a '${chi}': ${trovate.map(v => v.nome).join(', ')}`);
    throw errore(`Nessun file chiamato '${chi}' nell'archivio.`);
}

// Come Sort-Object: maiuscole e minuscole non contano, gli accenti sì ("papa" prima di "papà").
function confrontaNomi(a, b) {
    return String(a).localeCompare(String(b), 'it', { sensitivity: 'accent' });
}

export function riepilogo(ctx) {
    const adesso = oggi(ctx);
    const f = fattore(ctx);
    const voci = ctx.stato.voci;
    const gruppi = Object.fromEntries(ORDINE_STATI.map(s => [s, 0]));
    const righe = voci.map(v => {
        const st = statoVoce(v);
        gruppi[st]++;
        return { voce: v, stato: st, rango: ORDINE_STATI.indexOf(st), vitalita: vitalita(v, adesso, f) };
    });
    righe.sort((a, b) => a.rango - b.rango || confrontaNomi(a.voce.nome, b.voce.nome));
    let prima = 0, adessoByte = 0;
    for (const v of voci) {
        prima += Number(v.byteOriginali);
        for (const s of v.strati) if (s.vivo) adessoByte += Number(s.byte);
        adessoByte += String(v.descrizione).length;
    }
    const delta = prima ? (adessoByte - prima) / prima * 100 : 0;
    return { adesso, f, gruppi, righe, prima, adessoByte, delta, fissati: voci.filter(v => v.fissato).length };
}

export function mostraStato(ctx) {
    const { P, stato, uscita } = ctx;
    const r = riepilogo(ctx);
    uscita.riga('');
    uscita.riga(`  OBLIO · ${P.radice}`, 'White');
    const sim = Number(stato.offsetGiorni) !== 0 ? ` (tempo simulato: +${stato.offsetGiorni} giorni)` : '';
    uscita.riga(`  oggi ${formatData(r.adesso)}${sim} · velocità dell'oblio: ${stato.velocita}`, 'DarkGray');
    uscita.riga('');
    if (!stato.voci.length) {
        uscita.riga("  L'archivio è vuoto. Aggiungi qualcosa con:  oblio aggiungi <file|cartella>");
        return;
    }
    const colori = { nitido: 'White', sbiadito: 'Gray', essenza: 'DarkGray', traccia: 'DarkGray' };
    const massimo = Math.max(...Object.values(r.gruppi));
    for (const st of ORDINE_STATI) {
        const n = r.gruppi[st];
        const lun = massimo ? Math.ceil(20 * n / massimo) : 0;
        uscita.riga(`  ${aSinistra(PLURALI[st], 9)} ${aDestra(n, 3)}  ${'█'.repeat(lun)}`, colori[st]);
    }
    if (r.fissati) uscita.riga(`  ${aSinistra('fissati', 9)} ${aDestra(r.fissati, 3)}  (indimenticabili)`, 'Yellow');

    const segno = r.delta > 0 ? '+' : '';
    uscita.riga('');
    uscita.riga(`  spazio: ${formatByte(r.prima)} all'origine → ${formatByte(r.adessoByte)} oggi (${segno}${numero(r.delta, 0)}%)`, 'DarkGray');
    if (Number(stato.dimenticatiPerSempre)) {
        uscita.riga(`  dimenticati per sempre su richiesta: ${stato.dimenticatiPerSempre}`, 'DarkGray');
    }

    uscita.riga('');
    const formato = (a, b, c, d, e) => `  ${aSinistra(a, 24)} ${aSinistra(b, 9)} ${aSinistra(c, 15)} ${aSinistra(d, 27)} ${e}`;
    uscita.riga(formato('FILE', 'STATO', 'VITALITÀ', 'COSA RESTA', 'PROSSIMO OBLIO'), 'DarkGray');
    for (const riga of r.righe) {
        const v = riga.voce;
        const top = stratiVivi(v)[0];
        const resta = top ? `${top.nome} · ${top.dettaglio}` : 'solo la descrizione';
        let vit, prossimo, colore;
        if (v.fissato) {
            vit = 'fissato'; prossimo = 'mai'; colore = 'Yellow';
        } else if (!top) {
            vit = '░░░░░░░░░░ —'; prossimo = '—'; colore = colori[riga.stato];
        } else {
            const barra = '█'.repeat(arrotondaPari(riga.vitalita * 10)).padEnd(10, '░');
            vit = `${barra} ${decimali2(riga.vitalita)}`;
            const g = giorniAlProssimo(v, r.adesso, r.f);
            prossimo = g === null ? '—' : g <= 0 ? 'a breve' : `tra ${g} giorni`;
            colore = colori[riga.stato];
        }
        uscita.riga(formato(formatNome(v.nome), riga.stato, vit, formatNome(resta, 27), prossimo), colore);
    }
}

function scriviTestoBom(percorso, testo) {
    fs.writeFileSync(percorso, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(testo, 'utf8')]));
}

export function apriVoce(ctx, v, { mostra = false } = {}) {
    const { P, uscita } = ctx;
    fs.mkdirSync(P.ricordi, { recursive: true });
    const adesso = oggi(ctx);
    let dati = null, strato = null;
    for (const s of stratiVivi(v)) {
        try {
            dati = leggiStrato(ctx, v, s);
            strato = s;
            break;
        } catch {
            s.vivo = false;   // chiave o dati persi: lo strato è irrecuperabile
        }
    }

    const base = nomeBase(v.nome);
    let out, fonte;
    if (!strato) {
        out = path.join(P.ricordi, `${base}.traccia.txt`);
        const righe = [
            'TRACCIA DI UN FILE DIMENTICATO', '',
            `Nome:        ${v.nome}`,
            `Descrizione: ${v.descrizione}`,
            `Affidato a Oblio il ${formatData(leggiData(v.aggiunto))}`, '',
            'Di questo file resta solo la traccia: il contenuto non esiste più da nessuna parte.',
        ];
        scriviTestoBom(out, righe.join('\r\n'));
        fonte = 'solo la traccia: il contenuto è dimenticato';
    } else if (strato.nome === 'originale') {
        out = path.join(P.ricordi, v.nome);
        fs.writeFileSync(out, dati);
        fonte = 'originale, intatto';
    } else if (v.tipo === 'immagine') {
        // Qui un modello generativo potrebbe "reimmaginare" i dettagli.
        // Il prototipo si limita a ingrandire ciò che resta: un ricordo sfocato.
        const img = ridimensiona(decodifica(dati), Number(v.larghezza), Number(v.altezza));
        aggiungiFiligrana(img, `RICORDO RICOSTRUITO · NON ORIGINALE · da ${strato.dettaglio}`);
        out = path.join(P.ricordi, `${base}.ricordo.jpg`);
        fs.writeFileSync(out, codificaJpeg(img, 88));
        fonte = `ricostruito dallo strato «${strato.nome}» (${strato.dettaglio})`;
    } else {
        const intestazione = [
            "=== RICORDO RICOSTRUITO — NON È L'ORIGINALE ===",
            `Fonte: strato «${strato.nome}» (${strato.dettaglio}). Il resto è stato dimenticato e non si può recuperare.`,
            '', '',
        ].join('\r\n');
        out = path.join(P.ricordi, `${base}.ricordo.txt`);
        scriviTestoBom(out, intestazione + leggiTesto(dati));
        fonte = `ricostruito dallo strato «${strato.nome}» (${strato.dettaglio})`;
    }

    // Riconsolidamento: ripensare a un ricordo lo rafforza (una traccia non ha più nulla da rafforzare).
    const primaS = Number(v.stabilita);
    if (strato) v.stabilita = Math.min(STABILITA_MAX, primaS * RIPASSO);
    v.ultimoAccesso = isoOra(adesso);
    v.accessi = Number(v.accessi || 0) + 1;

    uscita.riga('');
    uscita.riga(`  Aperto:  ${v.nome}`, 'White');
    uscita.riga(`  Fonte:   ${fonte}`);
    uscita.riga(`  File:    ${out}`);
    if (v.fissato) {
        uscita.riga('  È fissato: non sbiadirà mai.', 'Yellow');
    } else if (strato) {
        uscita.riga(`  Riconsolidato: stabilità ${numero(primaS, 0)} → ${numero(v.stabilita, 0)} giorni. Da qui in poi sbiadisce più lentamente.`, 'Green');
    }
    if (mostra) {
        // l'errore di spawn arriva dopo, come evento: senza ascoltarlo Node mostrerebbe la sua pila
        try { spawn('open', [out], { detached: true, stdio: 'ignore' }).on('error', () => { /* niente Finder: pazienza */ }).unref(); } catch { /* idem */ }
    }
    return { voce: v, out, fonte, strato: strato ? strato.nome : null, ricostruito: Boolean(strato && strato.nome !== 'originale') };
}

// Il testo leggibile di uno strato (per i PDF e i .docx originali, il testo estratto).
function testoDiStrato(v, s, dati) {
    const est = estensione(v.nome).toLowerCase();
    if (s.nome === 'originale' && EST_DOCUMENTI.includes(est)) return estraiTesto(dati, est) || '';
    return leggiTesto(dati);
}

export function cercaRicordi(ctx, cosa) {
    const { uscita } = ctx;
    if (!cosa) throw errore('Cosa devo cercare?  oblio cerca <parola>');
    uscita.riga('');
    const trovati = [];
    for (const v of ctx.stato.voci) {
        const dove = [];
        if (contieneSenzaMaiuscole(v.nome, cosa)) dove.push('nel nome');
        if (contieneSenzaMaiuscole(v.descrizione, cosa)) dove.push('nella traccia');
        if (v.tipo === 'testo') {
            const top = stratiVivi(v)[0];
            if (top) {
                try {
                    if (contieneSenzaMaiuscole(testoDiStrato(v, top, leggiStrato(ctx, v, top)), cosa)) dove.push(`nel testo (${top.nome})`);
                } catch { /* strato illeggibile: resta la traccia */ }
            }
        }
        if (dove.length) {
            trovati.push({ id: v.id, nome: v.nome, stato: statoVoce(v), dove, descrizione: v.descrizione });
            uscita.riga(`  ${aSinistra(formatNome(v.nome), 24)} ${aSinistra(statoVoce(v), 9)} trovato ${dove.join(', ')}`, 'White');
            uscita.riga(`      ${v.descrizione}`, 'DarkGray');
        }
    }
    if (!trovati.length) uscita.riga(`  Nessun ricordo contiene '${cosa}'.`, 'DarkGray');
    return trovati;
}

export function mostraVelocita(ctx) {
    const { uscita, stato } = ctx;
    uscita.riga('');
    for (const t of tabellaVelocita()) {
        const attuale = t.nome === String(stato.velocita).toLowerCase();   // come -eq di PowerShell
        const segno = attuale ? '▶' : ' ';
        uscita.riga(`  ${segno} ${aSinistra(t.nome, 12)} nitido ~${t.nitido} gg · sbiadito fino a ~${t.sbiadito} gg · essenza fino a ~${t.essenza} gg, poi traccia`, attuale ? 'White' : 'Gray');
    }
    uscita.riga("  (per un file mai riaperto; ogni apertura rallenta l'oblio)", 'DarkGray');
}

export function fissa(ctx, chi) {
    const v = trovaVoce(ctx.stato, chi);
    v.fissato = true; v.motivoFissato = 'scelto da te';
    ctx.uscita.riga('');
    ctx.uscita.riga(`  ${v.nome} ora è indimenticabile.`, 'Yellow');
    const st = statoVoce(v);
    if (st !== 'nitido') ctx.uscita.riga(`  Ciò che era già sbiadito non torna: resterà per sempre così (${st}).`, 'DarkGray');
    return v;
}

export function libera(ctx, chi) {
    const v = trovaVoce(ctx.stato, chi);
    v.fissato = false; v.motivoFissato = '';
    v.ultimoAccesso = isoOra(oggi(ctx));
    ctx.uscita.riga('');
    ctx.uscita.riga(`  ${v.nome} torna a seguire il corso dell'oblio, a partire da oggi.`);
    return v;
}

export function dimentica(ctx, chi, conferma) {
    const { uscita } = ctx;
    const v = trovaVoce(ctx.stato, chi);
    uscita.riga('');
    if (!conferma) {
        uscita.riga(`  Stai per dimenticare PER SEMPRE '${v.nome}': chiavi distrutte, traccia cancellata, nessun ritorno.`, 'Yellow');
        uscita.riga(`  Per procedere:  oblio dimentica "${v.nome}" -Conferma`);
        return false;
    }
    for (const s of v.strati) if (s.vivo) rimuoviStrato(ctx, v, s);
    // anche le chiavi rimaste per errore (strati già "morti") vanno distrutte
    for (const k of [...ctx.chiavi.keys()]) if (k.startsWith(`${v.id}/`)) { ctx.chiavi.get(k).fill(0); ctx.chiavi.delete(k); }
    const cartella = path.join(ctx.P.strati, v.id);
    if (fs.existsSync(cartella)) fs.rmSync(cartella, { recursive: true, force: true });
    ctx.stato.voci = ctx.stato.voci.filter(x => x.id !== v.id);
    ctx.stato.dimenticatiPerSempre = Number(ctx.stato.dimenticatiPerSempre || 0) + 1;
    uscita.riga(`  '${v.nome}' è stato dimenticato per sempre.`, 'Cyan');
    uscita.riga('  Eventuali copie già estratte in /ricordi restano: quelle sono tue.', 'DarkGray');
    return true;
}

// Novità: "oblio domani [giorni]" mostra cosa sbiadirà, senza cambiare nulla.
export function mostraDomani(ctx, giorni = 30) {
    const { uscita } = ctx;
    const previsioni = anteprimaDomani(ctx.stato, giorni, ctx.ora());
    uscita.riga('');
    if (!previsioni.length) {
        uscita.riga(`  Nei prossimi ${giorni} giorni non sbiadirà nulla, anche senza riaprire niente.`, 'DarkGray');
        return previsioni;
    }
    uscita.riga(`  Nei prossimi ${giorni} giorni, se non riapri nulla, Oblio dimenticherà:`, 'Cyan');
    for (const p of previsioni) {
        const quando = p.traGiorni <= 0 ? 'a breve' : p.traGiorni === 1 ? 'domani' : `tra ${p.traGiorni} giorni`;
        const cosa = p.dettaglio === formatByte(p.byte) ? `${p.strato} (${p.dettaglio})` : `${p.strato} (${p.dettaglio}, ${formatByte(p.byte)})`;
        uscita.riga(`    ${aSinistra(formatNome(p.nome), 24)} ${aSinistra(quando, 14)} perde ${cosa} → ${p.diventa}`, 'Cyan');
    }
    uscita.riga('  Per salvare un ricordo basta riaprirlo (oblio apri <nome>) o fissarlo (oblio fissa <nome>).', 'DarkGray');
    return previsioni;
}

export const AIUTO = `
  OBLIO — il file system che dimentica come un essere umano

  oblio crea                          crea un archivio (default: ./archivio-oblio)
  oblio aggiungi <file|cartella>      affida file all'oblio (copia; con -Sposta rimuove l'originale)
  oblio stato                         cosa è nitido, cosa sbiadisce, cosa resta solo come traccia
  oblio apri <nome> [-Mostra]         ricostruisce il file in /ricordi e lo riconsolida
  oblio cerca <parola>                cerca anche tra i file dimenticati, nelle loro tracce
  oblio fissa <nome>                  rende un file indimenticabile
  oblio libera <nome>                 lo restituisce al corso dell'oblio
  oblio dimentica <nome> -Conferma    oblio immediato e totale, traccia compresa
  oblio velocita [elefante|normale|pesce-rosso]
  oblio tempo [<giorni>|reset]        simula il passare del tempo
  oblio domani [<giorni>]             cosa sbiadirà nei prossimi giorni (30 se non dici quanti)

  Opzione per tutti i comandi:  -Archivio <cartella>   (oppure la variabile OBLIO_ARCHIVIO)
`;

export const COMANDI = ['aggiungi', 'stato', 'apri', 'cerca', 'fissa', 'libera', 'dimentica', 'velocita', 'velocità', 'tempo', 'domani'];

// Le date che DateTime di .NET sa rappresentare: dal 1/1/0001 al 31/12/9999.
const DATA_MIN = new Date(0).setUTCFullYear(1, 0, 1);   // Date.UTC(1, ...) vorrebbe dire 1901
const DATA_MAX = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function interoNet(s) {
    const t = String(s).trim();
    if (!/^[+-]?\d+$/.test(t)) return null;
    const n = Number(t);
    return n >= -2147483648 && n <= 2147483647 ? n : null;
}

// Il cuore della riga di comando: stesso flusso di Invoke-Main.
// opzioni: { archivio, sposta, conferma, mostra, env, cwd, ora }
export function esegui(comando = 'aiuto', argomento = '', opzioni = {}, uscita = new Uscita()) {
    const radice = risolviRadice(opzioni.archivio, opzioni.env || process.env, opzioni.cwd || process.cwd());
    const P = percorsi(radice);
    const cmd = String(comando || 'aiuto').toLowerCase();
    const risultato = { comando: cmd, radice };

    if (['aiuto', 'help', '-h', '--help', '/?'].includes(cmd)) { uscita.riga(AIUTO); return risultato; }
    if (cmd === 'crea') { risultato.creato = creaArchivio(P, uscita); return risultato; }
    if (!COMANDI.includes(cmd)) throw errore(`Comando sconosciuto: '${comando}'. Scrivi:  oblio aiuto`);

    const ctx = { P, stato: leggiStato(P), chiavi: leggiChiavi(P), uscita, ora: opzioni.ora || (() => Date.now()) };
    try {
        let avanzato = false;
        if (cmd === 'tempo' && argomento) {
            // come "-eq 'reset'" di PowerShell: maiuscole e minuscole non contano
            if (String(argomento).toLowerCase() === 'reset') {
                ctx.stato.offsetGiorni = 0;
                uscita.riga('');
                uscita.riga(`  Orologio riportato a oggi: ${formatData(oggi(ctx))}.`, 'Magenta');
            } else {
                const giorni = interoNet(argomento);
                if (giorni === null) throw errore(`Numero di giorni non valido: '${argomento}'`);
                const offset = Number(ctx.stato.offsetGiorni || 0) + giorni;
                // Su Windows DateTime.AddDays fallisce fuori dagli anni 1-9999 e non salva nulla:
                // qui la data diventerebbe "NaN undefined NaN" e l'archivio smetterebbe di dimenticare.
                const t = oggiDi({ offsetGiorni: offset }, ctx.ora()).getTime();
                if (!(t >= DATA_MIN && t <= DATA_MAX)) throw errore(`Numero di giorni non valido: '${argomento}' (la data uscirebbe dal calendario)`);
                ctx.stato.offsetGiorni = offset;
                avanzato = true;
                uscita.riga('');
                uscita.riga(`  Il tempo avanza di ${giorni} giorni (simulazione). Oggi è il ${formatData(oggi(ctx))}.`, 'Magenta');
            }
        }

        // Prima di ogni comando, il tempo trascorso fa il suo lavoro.
        const eventi = invocaOblio(ctx);
        risultato.eventi = eventi;
        if (eventi.length) mostraEventi(uscita, eventi, cmd === 'tempo');
        else if (avanzato) uscita.riga('  Nessun ricordo è sbiadito.', 'DarkGray');

        switch (cmd) {
            case 'aggiungi': risultato.aggiunte = aggiungiPercorso(ctx, argomento, { sposta: opzioni.sposta }); break;
            case 'stato': mostraStato(ctx); break;
            case 'apri': risultato.apertura = apriVoce(ctx, trovaVoce(ctx.stato, argomento), { mostra: opzioni.mostra }); break;
            case 'cerca': risultato.trovati = cercaRicordi(ctx, argomento); break;
            case 'fissa': risultato.voce = fissa(ctx, argomento); break;
            case 'libera': risultato.voce = libera(ctx, argomento); break;
            case 'dimentica': risultato.dimenticato = dimentica(ctx, argomento, opzioni.conferma); break;
            case 'velocita': case 'velocità':
                if (argomento) {
                    if (!Object.hasOwn(VELOCITA, String(argomento).toLowerCase())) {
                        throw errore(`Velocità sconosciuta: '${argomento}'. Scegli tra: ${Object.keys(VELOCITA).join(', ')}`);
                    }
                    ctx.stato.velocita = String(argomento).toLowerCase();
                }
                mostraVelocita(ctx);
                break;
            case 'tempo':
                if (!argomento) {
                    uscita.riga('');
                    uscita.riga(`  Oggi è il ${formatData(oggi(ctx))} (spostamento simulato: ${ctx.stato.offsetGiorni} giorni).`);
                }
                break;
            case 'domani': {
                let giorni = 30;
                if (argomento) {
                    giorni = interoNet(argomento);
                    if (giorni === null || giorni < 0) throw errore(`Numero di giorni non valido: '${argomento}'`);
                }
                risultato.previsioni = mostraDomani(ctx, giorni);
                break;
            }
            default: break;
        }
    } finally {
        // Si salva anche se il comando fallisce: ciò che il tempo ha già dimenticato resta dimenticato.
        salva(ctx);
    }
    return risultato;
}

// ---------------------------------------------------------------------------
// Per l'interfaccia web: una fotografia dell'archivio e l'anteprima dei ricordi
// ---------------------------------------------------------------------------
export function istantanea(ctx) {
    const r = riepilogo(ctx);
    const voci = r.righe.map(({ voce: v, stato, vitalita: vit }) => {
        const top = stratiVivi(v)[0];
        return {
            id: v.id,
            nome: v.nome,
            tipo: v.tipo,
            descrizione: v.descrizione,
            stato,
            vitalita: v.fissato ? 1 : (top ? vit : 0),
            vitalitaVera: vit,
            fissato: Boolean(v.fissato),
            motivoFissato: v.motivoFissato || '',
            resta: top ? `${top.nome} · ${top.dettaglio}` : 'solo la descrizione',
            strato: top ? top.nome : null,
            prossimo: giorniAlProssimo(v, r.adesso, r.f),
            stabilita: Number(v.stabilita),
            accessi: Number(v.accessi || 0),
            aggiunto: v.aggiunto,
            ultimoAccesso: v.ultimoAccesso,
            larghezza: Number(v.larghezza || 0),
            altezza: Number(v.altezza || 0),
            byteOriginali: Number(v.byteOriginali),
            strati: v.strati.map(s => ({ nome: s.nome, soglia: Number(s.soglia), dettaglio: s.dettaglio, byte: Number(s.byte), vivo: Boolean(s.vivo), dimenticatoIl: s.dimenticatoIl })),
        };
    });
    return {
        radice: ctx.P.radice,
        oggi: r.adesso.toISOString(),
        oggiTesto: formatData(r.adesso),
        offsetGiorni: Number(ctx.stato.offsetGiorni || 0),
        velocita: ctx.stato.velocita,
        velocita_tabella: tabellaVelocita(),
        gruppi: r.gruppi,
        fissati: r.fissati,
        spazio: { prima: r.prima, oggi: r.adessoByte, delta: r.delta, primaTesto: formatByte(r.prima), oggiTesto: formatByte(r.adessoByte) },
        dimenticatiPerSempre: Number(ctx.stato.dimenticatiPerSempre || 0),
        voci,
    };
}

// Lo strato migliore da mostrare in anteprima, senza riconsolidare nulla.
// Per le immagini si preferisce lo strato medio (480 px): basta per una scheda.
export function anteprima(ctx, v) {
    const vivi = stratiVivi(v);
    if (!vivi.length) return null;
    let scelto = vivi[0];
    if (v.tipo === 'immagine') scelto = vivi.find(s => s.nome === 'media') || vivi.find(s => s.nome === 'miniatura') || vivi[0];
    if (v.tipo === 'binario') return null;
    let dati;
    try { dati = leggiStrato(ctx, v, scelto); } catch { return null; }
    if (v.tipo === 'immagine') {
        const formato = formatoImmagine(dati);
        if (!formato || formato === 'tiff') {
            // il browser potrebbe non saperlo mostrare: meglio la versione media
            const media = vivi.find(s => s.nome === 'media' || s.nome === 'miniatura');
            if (media && media !== scelto) { try { return { tipo: 'immagine', strato: media.nome, mime: 'image/jpeg', dati: leggiStrato(ctx, v, media) }; } catch { return null; } }
            return null;
        }
        return { tipo: 'immagine', strato: scelto.nome, mime: TIPI_MIME[formato], dati };
    }
    return { tipo: 'testo', strato: scelto.nome, testo: testoDiStrato(v, scelto, dati) };
}

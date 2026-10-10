#!/usr/bin/env node
// Oblio nel browser: un server HTTP senza dipendenze che serve l'interfaccia
// (web/) e qualche API JSON. Usa lo stesso nucleo della riga di comando.
//
// Uso:  node server.mjs [--archivio <cartella>]
//   archivio: --archivio, poi la variabile OBLIO_ARCHIVIO, poi la demo Mac (mac/demo/archivio)
//   porta:    la variabile PORT, altrimenti 5178. Ascolta solo su 127.0.0.1.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    esegui, Uscita, percorsi, esisteArchivio, apriContesto, invocaOblio, mostraEventi,
    salva, istantanea, anteprima, trovaVoce, messaggioErrore, ErroreOblio,
} from './lib/archivio.mjs';
import { anteprimaDomani } from './lib/modello.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(QUI, 'web');
const LIB = path.join(QUI, 'lib');
export const PORTA_PREDEFINITA = 5178;
export const ARCHIVIO_DEMO = path.join(QUI, 'demo', 'archivio');

// I moduli del nucleo che il browser può importare (niente node:*).
const LIB_CONDIVISE = new Set(['formato.js', 'modello.js']);

const TIPI = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webmanifest': 'application/manifest+json',
};
const tipoDi = f => TIPI[path.extname(f).toLowerCase()] || 'application/octet-stream';

const COMANDI_WEB = new Set(['crea', 'stato', 'apri', 'cerca', 'fissa', 'libera', 'dimentica', 'velocita', 'tempo', 'domani']);
const LIMITE_CARICAMENTO = 512 * 1024 * 1024;
const HOST_LOCALI = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function creaServer({ archivio } = {}) {
    const radice = path.resolve(archivio || process.env.OBLIO_ARCHIVIO || ARCHIVIO_DEMO);
    const P = percorsi(radice);

    // Una cosa alla volta: l'archivio è un file JSON, niente scritture concorrenti.
    let coda = Promise.resolve();
    const inFila = fn => {
        const r = coda.then(fn, fn);
        coda = r.catch(() => {});
        return r;
    };

    const fotografia = (uscita = new Uscita()) => {
        if (!esisteArchivio(P)) return { esiste: false, radice };
        const ctx = apriContesto(radice, uscita);
        const eventi = invocaOblio(ctx);
        if (eventi.length) { mostraEventi(uscita, eventi, false); salva(ctx); }
        return {
            esiste: true,
            ...istantanea(ctx),
            eventi,
            domani: anteprimaDomani(ctx.stato, 30, ctx.ora()),
        };
    };

    const urlRicordo = file => `/api/ricordi/${encodeURIComponent(path.basename(file))}`;

    function riassumiRisultato(r) {
        const out = {};
        if (r.apertura) {
            const a = r.apertura;
            out.apertura = {
                id: a.voce.id, nome: a.voce.nome, tipo: a.voce.tipo, fonte: a.fonte, strato: a.strato,
                ricostruito: a.ricostruito, file: a.out, url: urlRicordo(a.out),
            };
            if (/\.(txt|md|log|csv)$/i.test(a.out)) {
                try { out.apertura.testo = fs.readFileSync(a.out, 'utf8').replace(/^﻿/, '').slice(0, 200000); } catch { /* pazienza */ }
            }
        }
        if (r.trovati) out.trovati = r.trovati;
        if (r.previsioni) out.previsioni = r.previsioni;
        if (r.eventi) out.eventi = r.eventi;
        if (r.aggiunte) out.aggiunte = r.aggiunte.map(v => ({ id: v.id, nome: v.nome, tipo: v.tipo, fissato: v.fissato }));
        if (typeof r.dimenticato === 'boolean') out.dimenticato = r.dimenticato;
        return out;
    }

    async function api(req, res, url) {
        const via = url.pathname;

        if (req.method === 'GET' && via === '/api/stato') {
            const uscita = new Uscita();
            const dati = await inFila(() => fotografia(uscita));
            return json(res, 200, { ...dati, messaggi: uscita.righe });
        }

        if (req.method === 'POST' && via === '/api/comando') {
            let corpo;
            try { corpo = JSON.parse((await leggiCorpo(req, 1e6)).toString('utf8') || '{}'); } catch (e) {
                if (e.status) throw e;
                return json(res, 400, { errore: 'Richiesta non valida: serve un oggetto JSON.' });
            }
            if (!corpo || typeof corpo !== 'object') return json(res, 400, { errore: 'Richiesta non valida: serve un oggetto JSON.' });
            if (corpo.argomento != null && typeof corpo.argomento === 'object') return json(res, 400, { errore: "Richiesta non valida: l'argomento deve essere un testo." });
            const comando = String(corpo.comando || '').toLowerCase();
            if (!COMANDI_WEB.has(comando)) return json(res, 400, { errore: `Comando non disponibile dal browser: '${comando}'.` });
            const uscita = new Uscita();
            return inFila(() => {
                try {
                    const r = esegui(comando, corpo.argomento == null ? '' : String(corpo.argomento),
                        { archivio: radice, conferma: corpo.conferma === true }, uscita);
                    const stato = fotografia(new Uscita());
                    return json(res, 200, { ok: true, messaggi: uscita.righe, risultato: riassumiRisultato(r), stato });
                } catch (e) {
                    let stato = null;
                    try { stato = fotografia(new Uscita()); } catch { /* archivio assente */ }
                    return json(res, 400, { ok: false, errore: testoErrore(e), messaggi: uscita.righe, stato });
                }
            });
        }

        if (req.method === 'POST' && via === '/api/aggiungi') {
            const nome = path.basename(String(url.searchParams.get('nome') || '')).replace(/[\u0000-\u001f/\\:]/g, '_');
            if (!nome.trim() || nome === '.' || nome === '..' || nome.startsWith('.')) return json(res, 400, { errore: 'Nome di file non valido.' });
            if ([...nome].length > 255) return json(res, 400, { errore: 'Nome di file troppo lungo: al massimo 255 caratteri.' });
            const dati = await leggiCorpo(req, LIMITE_CARICAMENTO);
            const modificato = Number(url.searchParams.get('modificato'));
            const uscita = new Uscita();
            return inFila(() => {
                const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'oblio-arrivi-'));
                try {
                    const file = path.join(cartella, nome);
                    fs.writeFileSync(file, dati);
                    if (Number.isFinite(modificato) && modificato > 0) {
                        const quando = new Date(modificato);
                        fs.utimesSync(file, quando, quando);
                    }
                    const r = esegui('aggiungi', file, { archivio: radice, sposta: true }, uscita);
                    return json(res, 200, { ok: true, messaggi: uscita.righe, risultato: riassumiRisultato(r), stato: fotografia(new Uscita()) });
                } catch (e) {
                    return json(res, 400, { ok: false, errore: testoErrore(e), messaggi: uscita.righe });
                } finally {
                    fs.rmSync(cartella, { recursive: true, force: true });
                }
            });
        }

        let m;
        if (req.method === 'GET' && (m = /^\/api\/anteprima\/([^/]+)$/.exec(via))) {
            const id = decodeURIComponent(m[1]);
            return inFila(() => {
                if (!esisteArchivio(P)) return json(res, 404, { errore: 'Archivio inesistente.' });
                const ctx = apriContesto(radice);
                let v;
                try { v = trovaVoce(ctx.stato, id); } catch (e) { return json(res, 404, { errore: testoErrore(e) }); }
                const a = anteprima(ctx, v);
                if (!a) return json(res, 404, { errore: 'Di questo ricordo non resta nulla da mostrare.' });
                if (a.tipo === 'immagine') {
                    res.writeHead(200, { 'Content-Type': a.mime, 'Cache-Control': 'no-store', 'X-Oblio-Strato': a.strato });
                    return res.end(a.dati);
                }
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Oblio-Strato': a.strato });
                return res.end(a.testo);
            });
        }

        if (req.method === 'GET' && (m = /^\/api\/ricordi\/([^/]+)$/.exec(via))) {
            const nome = path.basename(decodeURIComponent(m[1]));
            const file = path.join(P.ricordi, nome);
            if (!file.startsWith(P.ricordi + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return json(res, 404, { errore: 'Ricordo non trovato.' });
            }
            // Un ricordo è un file dell'utente (magari una pagina .html scaricata): il browser lo mostra
            // ma non ne esegue gli script con i permessi di questa pagina (che può dimenticare tutto).
            res.writeHead(200, {
                'Content-Type': tipoDi(file), 'Cache-Control': 'no-store',
                'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff',
            });
            return fs.createReadStream(file).pipe(res);
        }

        return json(res, 404, { errore: 'Indirizzo sconosciuto.' });
    }

    function statico(req, res, url) {
        let via = decodeURIComponent(url.pathname);
        let file;
        if (via === '/' || via === '/index.html') file = path.join(WEB, 'index.html');
        else if (via.startsWith('/lib/')) {
            const nome = via.slice(5);
            if (!LIB_CONDIVISE.has(nome)) return json(res, 404, { errore: 'Non trovato.' });
            file = path.join(LIB, nome);
        } else {
            file = path.join(WEB, path.normalize(via).replace(/^(\.\.[/\\])+/, ''));
            if (!file.startsWith(WEB + path.sep)) return json(res, 403, { errore: 'Vietato.' });
        }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { errore: 'Non trovato.' });
        res.writeHead(200, { 'Content-Type': tipoDi(file), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
    }

    const server = http.createServer(async (req, res) => {
        try {
            // Solo nomi locali: un sito che fa puntare il suo dominio a 127.0.0.1 (DNS rebinding)
            // avrebbe altrimenti la stessa origine della pagina e potrebbe leggere e dimenticare tutto.
            if (!HOST_LOCALI.test(String(req.headers.host || ''))) return json(res, 403, { errore: 'Indirizzo non consentito: apri Oblio da http://127.0.0.1 o http://localhost.' });
            const url = new URL(req.url, 'http://127.0.0.1');
            // Solo questa pagina può cambiare l'archivio: niente richieste da altri siti.
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                const origine = req.headers.origin;
                if (origine && origine !== `http://${req.headers.host}`) return json(res, 403, { errore: 'Richiesta da un altro sito: rifiutata.' });
            }
            if (url.pathname.startsWith('/api/')) return await api(req, res, url);
            if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { errore: 'Metodo non consentito.' });
            return statico(req, res, url);
        } catch (e) {
            // indirizzi con %-codifiche rotte: è la richiesta a essere sbagliata, non il server
            if (e instanceof URIError) e = Object.assign(new Error('Indirizzo non valido.'), { status: 400 });
            if (!res.headersSent) json(res, e.status || 500, { errore: e.status ? e.message : testoErrore(e) });
            else res.end();
        }
    });
    server.radice = radice;
    return server;
}

// Gli errori per la pagina: in italiano, come nella riga di comando, e mai i messaggi
// inglesi di Node o di JavaScript (quelli finiscono solo nella finestra del server).
// (Gli Error semplici senza codice vengono dal nucleo e sono già in italiano.)
export function testoErrore(e) {
    if (e instanceof ErroreOblio) return e.message;
    if (typeof e?.code === 'string') {
        const m = messaggioErrore(e);
        if (m !== e.message) return m;
        console.error(`  [oblio] ${e.stack || e}`);
        return `Errore del disco (${e.code}).`;
    }
    if (e?.constructor === Error) return e.message;
    console.error(`  [oblio] ${e?.stack || e}`);
    return "Errore imprevisto: l'archivio potrebbe essere rovinato. I dettagli sono nella finestra del server.";
}

function json(res, codice, dati) {
    res.writeHead(codice, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(dati));
}

// Oltre il limite si smette di tenere i dati ma si lascia finire l'invio, scartandolo:
// se si chiudesse la connessione a metà, il browser vedrebbe "il server non risponde"
// invece del messaggio 413.
function leggiCorpo(req, limite) {
    return new Promise((ok, ko) => {
        const troppo = () => {
            const e = new Error(`File troppo grande per il caricamento dal browser (al massimo ${Math.round(limite / 1048576)} MB).`);
            e.status = 413;
            return e;
        };
        const pezzi = [];
        let n = Number(req.headers['content-length']) > limite ? Infinity : 0;
        req.on('data', p => {
            n += p.length;
            if (n > limite) { pezzi.length = 0; return; }
            pezzi.push(p);
        });
        req.on('end', () => (n > limite ? ko(troppo()) : ok(Buffer.concat(pezzi))));
        req.on('error', ko);
    });
}

// Avvio diretto: node server.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const argv = process.argv.slice(2);
    let archivio;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (/^-{1,2}archivio$/i.test(a)) archivio = argv[++i];
        else if (/^-{1,2}archivio=/i.test(a)) archivio = a.split('=').slice(1).join('=');
    }
    const porta = Number(process.env.PORT) || PORTA_PREDEFINITA;
    const server = creaServer({ archivio });
    server.on('error', e => {
        console.error(e.code === 'EADDRINUSE' ? `  La porta ${porta} è già occupata: forse Oblio è già acceso.` : `  Errore: ${e.message}`);
        process.exit(1);
    });
    server.listen(porta, '127.0.0.1', () => {
        console.log('');
        console.log(`  Oblio è in ascolto su http://127.0.0.1:${porta}`);
        console.log(`  Archivio: ${server.radice}`);
        console.log('  Premi Ctrl+C per spegnerlo.');
    });
}

// Attrezzi comuni ai test: archivi temporanei, comandi che raccolgono l'uscita.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esegui, Uscita, apriContesto } from '../lib/archivio.mjs';

export const MAC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OBLIO = path.resolve(MAC, '..');
export const DEMO_WINDOWS = path.join(OBLIO, 'demo', 'archivio');
export const FIXTURE = path.join(MAC, 'test', 'fixture');

export function cartellaTemporanea(prefisso = 'oblio-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefisso));
}

export function pulisci(...cartelle) {
    for (const c of cartelle) fs.rmSync(c, { recursive: true, force: true });
}

// Esegue un comando come "oblio <comando> <argomento> -Archivio <archivio>" e restituisce il testo stampato.
export function oblio(archivio, comando, argomento = '', extra = {}) {
    const uscita = new Uscita();
    const risultato = esegui(comando, argomento, { archivio, ...extra }, uscita);
    return { risultato, testo: uscita.righe.map(r => r.testo).join('\n'), righe: uscita.righe };
}

// Come oblio(), ma se il comando fallisce restituisce il messaggio d'errore.
export function oblioErrore(archivio, comando, argomento = '', extra = {}) {
    try {
        oblio(archivio, comando, argomento, extra);
    } catch (e) {
        return e.message;
    }
    return null;
}

export function nuovoArchivio() {
    const base = cartellaTemporanea();
    const archivio = path.join(base, 'archivio');
    oblio(archivio, 'crea');
    return { base, archivio };
}

export function scriviFile(cartella, nome, contenuto, modificato = new Date(2026, 7, 12, 18, 30)) {
    fs.mkdirSync(cartella, { recursive: true });
    const p = path.join(cartella, nome);
    fs.writeFileSync(p, contenuto);
    fs.utimesSync(p, modificato, modificato);
    return p;
}

export function contesto(archivio) {
    return apriContesto(archivio);
}

export function voce(archivio, nome) {
    return contesto(archivio).stato.voci.find(v => v.nome === nome);
}

export function copiaDemoWindows() {
    const base = cartellaTemporanea('oblio-compat-');
    const archivio = path.join(base, 'archivio');
    fs.cpSync(DEMO_WINDOWS, archivio, { recursive: true });
    return { base, archivio };
}

export const DIARIO = `Il 12 agosto siamo arrivati al mare poco prima del tramonto, stanchi ma felici. La nonna aveva preparato la pasta con le melanzane e il profumo arrivava fino al cancello. Dopo cena siamo scesi in spiaggia a piedi nudi e la sabbia era ancora calda.

Il mare quella sera era calmo, quasi immobile, e rifletteva le luci del paese. Io avevo paura del cambiamento, ma la nonna ha riso. Domani si torna in città.`;

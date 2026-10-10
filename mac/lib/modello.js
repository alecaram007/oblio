// Modello della memoria di Oblio.
// Vitalità R = e^(-t/S): t = giorni dall'ultima apertura, S = stabilità.
// Uno strato sopravvive finché R resta sopra la sua soglia.
// Modulo condiviso tra Node e browser: nessun import di node:*.

import { GIORNO_MS, leggiData, arrotondaPari } from './formato.js';

export const STABILITA_BASE = 180.0;   // con velocità "normale" un file mai riaperto resta nitido ~4 mesi
export const RIPASSO = 2.5;            // ogni apertura moltiplica la stabilità (ripetizione spaziata)
export const STABILITA_MAX = 3650.0;
export const VELOCITA = { 'elefante': 4.0, 'normale': 1.0, 'pesce-rosso': 0.25 };

export const ORDINE_STATI = ['nitido', 'sbiadito', 'essenza', 'traccia'];
export const PLURALI = { nitido: 'nitidi', sbiadito: 'sbiaditi', essenza: 'essenze', traccia: 'tracce' };

export function oggi(stato, ora = Date.now()) {
    return new Date(ora + Number(stato.offsetGiorni || 0) * GIORNO_MS);
}

export function fattore(stato) {
    // solo le velocità vere: "constructor" o "toString" non sono velocità (darebbero NaN);
    // come il dizionario [ordered] di PowerShell, maiuscole e minuscole non contano ("Elefante")
    const k = String(stato.velocita).toLowerCase();
    const f = Object.hasOwn(VELOCITA, k) ? VELOCITA[k] : null;
    return f ? Number(f) : 1.0;
}

export function giorniDaAccesso(v, adesso) {
    const t = (adesso.getTime() - leggiData(v.ultimoAccesso).getTime()) / GIORNO_MS;
    return t < 0 ? 0 : t;
}

export function vitalita(v, adesso, f) {
    return Math.exp(-giorniDaAccesso(v, adesso) / (Number(v.stabilita) * f));
}

export function stratiVivi(v) {
    return (v.strati || []).filter(s => s.vivo).sort((a, b) => Number(b.soglia) - Number(a.soglia));
}

export function statoVoce(v) {
    const top = stratiVivi(v)[0];
    if (!top) return 'traccia';
    if (top.nome === 'originale') return 'nitido';
    if (Number(top.soglia) >= 0.2) return 'sbiadito';
    return 'essenza';
}

// Giorno (dall'ultima apertura) in cui la vitalità scende sotto la soglia di uno strato.
export function limiteStrato(v, s, f) {
    return -Number(v.stabilita) * f * Math.log(Number(s.soglia));
}

export function giorniAlProssimo(v, adesso, f) {
    const top = stratiVivi(v)[0];
    if (v.fissato || !top) return null;
    return Math.max(0, Math.ceil(limiteStrato(v, top, f) - giorniDaAccesso(v, adesso)));
}

// Quanto dura ogni stato per un file mai riaperto (tabella del README e di "oblio velocita").
export function tabellaVelocita() {
    return Object.entries(VELOCITA).map(([nome, f]) => {
        const S = STABILITA_BASE * f;
        return {
            nome,
            fattore: f,
            nitido: arrotondaPari(S * Math.log(2)),
            sbiadito: arrotondaPari(S * -Math.log(0.2)),
            essenza: arrotondaPari(S * -Math.log(0.05)),
        };
    });
}

// Novità: anteprima del "domani". Cosa sbiadirà nei prossimi `giorni` giorni
// se nessuno riapre nulla. Non cambia niente: è solo una previsione.
export function anteprimaDomani(stato, giorni = 30, ora = Date.now()) {
    const adesso = oggi(stato, ora);
    const f = fattore(stato);
    const previsioni = [];
    for (const v of stato.voci || []) {
        if (v.fissato) continue;
        const t = giorniDaAccesso(v, adesso);
        const vivi = stratiVivi(v);
        for (let i = 0; i < vivi.length; i++) {
            const s = vivi[i];
            const mancano = limiteStrato(v, s, f) - t;
            if (mancano > giorni) continue;
            const resta = vivi[i + 1];
            let dopo = 'traccia';
            if (resta) dopo = resta.nome === 'originale' ? 'nitido' : (Number(resta.soglia) >= 0.2 ? 'sbiadito' : 'essenza');
            previsioni.push({
                id: v.id,
                nome: v.nome,
                strato: s.nome,
                dettaglio: s.dettaglio,
                byte: s.byte,
                traGiorni: Math.max(0, Math.ceil(mancano)),
                diventa: dopo,
            });
        }
    }
    previsioni.sort((a, b) => a.traGiorni - b.traGiorni || a.nome.localeCompare(b.nome, 'it'));
    return previsioni;
}

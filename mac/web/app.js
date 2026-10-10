// Oblio nel browser: il cassetto della memoria.
// Usa gli stessi moduli del nucleo (formato.js, modello.js) che usa la riga di comando.

import { formatByte, formatData, decimali2 } from '/lib/formato.js';
import { ORDINE_STATI, PLURALI, giorniDaAccesso } from '/lib/modello.js';

const $ = s => document.querySelector(s);
const crea = (tag, attr = {}, ...figli) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attr)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'classe') el.className = v;
        else if (k === 'testo') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const f of figli.flat()) if (f !== null && f !== undefined && f !== false) el.append(f);
    return el;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attr = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attr)) el.setAttribute(k, v);
    return el;
};

let dati = null;           // l'ultima fotografia dell'archivio
let risultatiRicerca = null; // Map id → dove, oppure null

// ---------------------------------------------------------------------------
// Comunicare con il server
// ---------------------------------------------------------------------------
async function chiama(url, opzioni = {}) {
    document.body.classList.add('occupato');
    try {
        const r = await fetch(url, opzioni);
        const corpo = await r.json().catch(() => ({ errore: `Risposta inattesa (${r.status}).` }));
        return { ok: r.ok, ...corpo };
    } catch {
        return { ok: false, errore: 'Il server di Oblio non risponde: è ancora acceso?' };
    } finally {
        document.body.classList.remove('occupato');
    }
}

async function carica() {
    const r = await chiama('/api/stato');
    if (r.errore && !r.radice) return avviso(r.errore, true);
    scriviDiario(r.messaggi);
    mostra(r);
}

async function comando(nome, argomento = '', extra = {}) {
    const r = await chiama('/api/comando', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comando: nome, argomento, ...extra }),
    });
    scriviDiario(r.messaggi, `oblio ${nome}${argomento ? ' ' + argomento : ''}`);
    if (!r.ok) {
        scriviDiario([{ testo: `  Errore: ${r.errore}`, colore: 'Red' }]);
        avviso(r.errore, true);
    }
    if (r.stato) mostra(r.stato);
    return r;
}

// ---------------------------------------------------------------------------
// Disegnare la pagina
// ---------------------------------------------------------------------------
function mostra(d) {
    dati = d;
    $('#archivio').textContent = d.radice || '';
    const vuoto = $('#vuoto');
    if (!d.esiste) {
        $('#cassetto').replaceChildren();
        vuoto.hidden = false;
        vuoto.replaceChildren(
            crea('p', { testo: 'In questa cartella non c’è ancora un archivio Oblio.' }),
            crea('p', {}, 'Puoi crearne uno vuoto qui, oppure lanciare la demo con ', crea('code', { testo: 'npm run demo' }), ' e ricaricare la pagina.'),
            crea('button', { classe: 'pulsante primario', type: 'button', onclick: () => comando('crea') }, 'Crea l’archivio'),
        );
        $('#data-oggi').textContent = formatData(new Date());
        $('#nota-tempo').textContent = '';
        abilita(false);
        return;
    }
    abilita(true);
    mostraTempo(d);
    mostraRiepilogo(d);
    mostraDomani(d);
    mostraCassetto(d);
}

function abilita(si) {
    for (const el of document.querySelectorAll('.tempo button, .tempo input, #modulo-cerca button, #modulo-cerca input, #scegli-file')) el.disabled = !si;
    $('#deposito').toggleAttribute('aria-disabled', !si);
}

function mostraTempo(d) {
    $('#data-oggi').textContent = d.oggiTesto;
    $('#nota-tempo').textContent = d.offsetGiorni
        ? `Tempo simulato: ${d.offsetGiorni > 0 ? '+' : ''}${d.offsetGiorni} giorni rispetto a oggi.`
        : 'Nessun tempo simulato: è oggi davvero.';
    $('#torna-oggi').disabled = !d.offsetGiorni;
    // come il nucleo: "Elefante" scritto a mano in stato.json vale "elefante"
    const vel = String(d.velocita).toLowerCase();
    for (const r of document.querySelectorAll('input[name="velocita"]')) r.checked = r.value === vel;
    const t = d.velocita_tabella.find(x => x.nome === vel);
    if (t) {
        $('#nota-velocita').textContent =
            `Un file mai riaperto resta nitido ~${t.nitido} giorni, sbiadito fino a ~${t.sbiadito}, essenza fino a ~${t.essenza}; poi resta la traccia. Ogni apertura rallenta l’oblio.`;
    }
}

const COLORI_STATO = { nitido: 'c-nitido', sbiadito: 'c-sbiadito', essenza: 'c-essenza', traccia: 'c-traccia' };

function mostraRiepilogo(d) {
    const totale = d.voci.length || 1;
    const barra = $('#barra-stati');
    barra.replaceChildren(...ORDINE_STATI.filter(s => d.gruppi[s]).map(s =>
        crea('span', { classe: COLORI_STATO[s], style: `width:${(100 * d.gruppi[s] / totale).toFixed(2)}%` })));
    barra.setAttribute('aria-label', ORDINE_STATI.map(s => `${d.gruppi[s]} ${PLURALI[s]}`).join(', '));
    $('#legenda').replaceChildren(
        ...ORDINE_STATI.map(s => crea('li', {}, crea('span', { classe: `pallino ${COLORI_STATO[s]}`, 'aria-hidden': 'true' }), PLURALI[s], crea('b', { testo: String(d.gruppi[s]) }))),
        crea('li', {}, crea('span', { classe: 'pallino c-fissato', 'aria-hidden': 'true' }), 'fissati', crea('b', { testo: String(d.fissati) })),
    );
    const delta = Math.round(d.spazio.delta);
    let testo = `Spazio: ${d.spazio.primaTesto} all’origine, ${d.spazio.oggiTesto} oggi (${delta > 0 ? '+' : ''}${delta}%).`;
    if (d.dimenticatiPerSempre) testo += ` Dimenticati per sempre su richiesta: ${d.dimenticatiPerSempre}.`;
    $('#spazio').textContent = testo;
}

function quando(g) {
    if (g <= 0) return 'a breve';
    if (g === 1) return 'domani';
    return `tra ${g} giorni`;
}

function mostraDomani(d) {
    const lista = $('#lista-domani');
    if (!d.domani.length) {
        lista.replaceChildren(crea('li', { classe: 'vuota', testo: 'Nulla sbiadirà nei prossimi 30 giorni, anche senza riaprire niente.' }));
        return;
    }
    lista.replaceChildren(...d.domani.map(p => crea('li', {},
        crea('span', { classe: 'quando', testo: quando(p.traGiorni) }),
        crea('span', { classe: 'cosa' }, crea('strong', { testo: p.nome }), ` perde ${p.strato} (${p.dettaglio}) e diventa ${p.diventa}`))));
}

const SIMBOLI = { immagine: 'immagine', testo: 'testo', binario: 'file' };
const NOMI_STRATI = { originale: 'nitido', media: 'sbiadito', riassunto: 'sbiadito', miniatura: 'essenza', essenza: 'essenza' };

function mostraCassetto(d) {
    const cassetto = $('#cassetto');
    const vuoto = $('#vuoto');
    let voci = d.voci;
    if (risultatiRicerca) voci = voci.filter(v => risultatiRicerca.has(v.id));
    if (!d.voci.length) {
        vuoto.hidden = false;
        vuoto.replaceChildren(crea('p', { testo: 'Il cassetto è vuoto. Trascina qui sopra qualche file per affidarlo all’oblio.' }));
    } else {
        vuoto.hidden = true;
    }
    // Le schede vengono ridisegnate: chi usa la tastiera non deve ritrovarsi in cima alla pagina
    // dopo Fissa, Libera o Dimentica. Il fuoco torna allo stesso pulsante della stessa scheda
    // (o alla scheda che ha preso il posto di quella dimenticata).
    const attivo = document.activeElement;
    const vecchia = cassetto.contains(attivo) ? attivo.closest('.scheda') : null;
    // i pulsanti in fondo (Apri, Fissa/Libera, Dimentica) sono sempre tre; la curva può sparire
    const posto = vecchia ? [...vecchia.querySelectorAll('.azioni button')].indexOf(attivo) : -1;
    const indice = vecchia ? [...cassetto.children].indexOf(vecchia) : -1;
    cassetto.replaceChildren(...voci.map(v => scheda(v, d)));
    if (vecchia) {
        const nuova = [...cassetto.children].find(li => li.dataset.id === vecchia.dataset.id)
            || cassetto.children[Math.min(indice, cassetto.children.length - 1)];
        const comandi = nuova ? [...nuova.querySelectorAll(posto < 0 ? 'summary, .azioni button' : '.azioni button')] : [];
        (comandi[posto] || comandi[0] || cassetto).focus();
    }
}

function scheda(v, d) {
    const classi = ['scheda', `stato-${v.stato}`];
    if (v.fissato) classi.push('fissato');
    if (risultatiRicerca?.has(v.id)) classi.push('evidenza');
    const titoloId = `t-${v.id}`;
    return crea('li', { classe: classi.join(' '), 'aria-labelledby': titoloId, 'data-id': v.id },
        anteprima(v),
        crea('div', { classe: 'corpo-scheda' },
            crea('h3', { id: titoloId, testo: v.nome }),
            crea('div', { classe: 'distintivi' },
                crea('span', { classe: `distintivo d-${v.stato}`, testo: v.stato }),
                v.fissato ? crea('span', { classe: 'distintivo d-fissato', title: v.motivoFissato, testo: 'fissato' }) : null,
                crea('span', { classe: 'distintivo d-tipo', testo: SIMBOLI[v.tipo] || v.tipo })),
            barraVitalita(v),
            crea('dl', { classe: 'dati-scheda' },
                crea('dt', { testo: 'Cosa resta' }), crea('dd', { testo: v.resta }),
                crea('dt', { testo: 'Prossimo oblio' }), crea('dd', { testo: v.fissato ? 'mai' : v.prossimo === null ? '—' : quando(v.prossimo) }),
                risultatiRicerca?.has(v.id) ? [crea('dt', { testo: 'Trovato' }), crea('dd', { testo: risultatiRicerca.get(v.id).join(', ') })] : null),
            crea('ul', { classe: 'strati', 'aria-label': 'Strati' },
                ...[...v.strati].sort((a, b) => b.soglia - a.soglia).map(s => crea('li', {
                    classe: s.vivo ? '' : 'perso',
                    title: s.vivo ? `${s.dettaglio} · ${formatByte(s.byte)}` : `dimenticato il ${formatData(s.dimenticatoIl)}`,
                }, `${s.nome}${s.vivo ? '' : ' (perso)'}`))),
            crea('p', { classe: 'descrizione', testo: v.descrizione }),
            curva(v, d)),
        crea('div', { classe: 'azioni' },
            crea('button', { type: 'button', classe: 'pulsante primario piccolo', 'aria-label': `Apri ${v.nome}`, onclick: () => apri(v) }, 'Apri'),
            v.fissato
                ? crea('button', { type: 'button', classe: 'pulsante piccolo', 'aria-label': `Libera ${v.nome}`, onclick: () => comando('libera', v.id) }, 'Libera')
                : crea('button', { type: 'button', classe: 'pulsante piccolo', 'aria-label': `Fissa ${v.nome}`, onclick: () => comando('fissa', v.id) }, 'Fissa'),
            crea('button', { type: 'button', classe: 'pulsante pericolo piccolo', 'aria-label': `Dimentica ${v.nome}`, onclick: () => chiediDimentica(v) }, 'Dimentica')));
}

function anteprima(v) {
    const box = crea('div', { classe: 'anteprima' });
    const timbro = v.strato ? crea('span', { classe: 'timbro', testo: v.strato === 'originale' ? 'originale' : `ricordo: ${v.strato}` }) : null;
    if (!v.strato) {
        box.append(crea('div', { classe: 'traccia-anteprima' }, crea('span', { classe: 'simbolo', 'aria-hidden': 'true', testo: '∴' }), 'Resta solo la traccia.'));
        return box;
    }
    if (v.tipo === 'immagine') {
        const img = crea('img', {
            src: `/api/anteprima/${encodeURIComponent(v.id)}?s=${v.strato}&a=${encodeURIComponent(v.ultimoAccesso)}`,
            alt: `Anteprima di ${v.nome} dallo strato ${v.strato}`,
            loading: 'lazy', decoding: 'async',
            classe: v.strato === 'originale' ? 'strato-originale' : '',
        });
        img.addEventListener('load', () => {
            // l'anteprima mostra lo strato medio se c'è: lo scopriamo dalla larghezza
            if (img.naturalWidth <= 64) img.classList.add('strato-miniatura');
            else if (v.strato !== 'originale') img.classList.add('strato-media');
        });
        box.append(img, timbro);
        return box;
    }
    if (v.tipo === 'testo') {
        const p = crea('p', { classe: 'testo-anteprima', testo: '…' });
        fetch(`/api/anteprima/${encodeURIComponent(v.id)}?s=${v.strato}`).then(r => (r.ok ? r.text() : '')).then(t => {
            p.textContent = t.slice(0, 600) || '(vuoto)';
        }).catch(() => { p.textContent = ''; });
        box.append(p, timbro);
        return box;
    }
    box.append(crea('div', { classe: 'binario-anteprima' }, crea('span', { classe: 'simbolo', 'aria-hidden': 'true', testo: '▦' }), 'File binario: non sa sbiadire a metà.'), timbro);
    return box;
}

function barraVitalita(v) {
    const valore = v.fissato ? 1 : v.vitalita;
    const soglie = [...new Set(v.strati.map(s => s.soglia))];
    return crea('div', {
        classe: 'vitalita', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '1', 'aria-valuenow': valore.toFixed(2),
        'aria-label': `Vitalità di ${v.nome}`, 'aria-valuetext': v.fissato ? 'fissato, non sbiadisce' : decimali2(valore),
    },
    crea('div', { classe: 'binario' },
        crea('div', { classe: 'pieno', style: `width:${(valore * 100).toFixed(1)}%` }),
        ...soglie.map(s => crea('span', { classe: 'soglia', style: `left:${s * 100}%`, title: `soglia ${decimali2(s)}` }))),
    crea('span', { classe: 'valore', testo: v.fissato ? 'fissato' : (v.strato ? decimali2(valore) : '—') }));
}

// La curva dell'oblio di questo file: R = e^(-t / (S · fattore)), con le soglie degli strati.
function curva(v, d) {
    if (v.fissato || !v.strato) return null;
    const f = (d.velocita_tabella.find(x => x.nome === String(d.velocita).toLowerCase()) || { fattore: 1 }).fattore;
    const S = v.stabilita * f;
    // come il nucleo: con l'orologio riportato prima dell'ultima apertura il tempo trascorso è 0
    const t0 = giorniDaAccesso(v, new Date(d.oggi));
    const orizzonte = Math.max(S * 3.2, t0 * 1.15, 30);
    const W = 280, H = 110, m = { s: 26, d: 8, a: 8, b: 20 };
    const x = t => m.s + (W - m.s - m.d) * t / orizzonte;
    const y = r => m.a + (H - m.a - m.b) * (1 - r);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Curva dell'oblio: oggi la vitalità è ${decimali2(v.vitalita)}` });
    g.append(svg('line', { class: 'asse', x1: m.s, y1: y(0), x2: W - m.d, y2: y(0) }), svg('line', { class: 'asse', x1: m.s, y1: y(0), x2: m.s, y2: y(1) }));
    for (const s of [...new Set(v.strati.map(x => x.soglia))]) {
        g.append(svg('line', { class: 'soglia-linea', x1: m.s, y1: y(s), x2: W - m.d, y2: y(s) }));
        const t = svg('text', { x: 2, y: y(s) + 3 }); t.textContent = String(s).replace('.', ','); g.append(t);
    }
    let dPath = '';
    for (let i = 0; i <= 60; i++) {
        const t = orizzonte * i / 60;
        dPath += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(Math.exp(-t / S)).toFixed(1)}`;
    }
    g.append(svg('path', { class: 'linea', d: dPath }));
    g.append(svg('line', { class: 'oggi-linea', x1: x(t0), y1: y(0), x2: x(t0), y2: y(1) }));
    const oggi = svg('text', { x: Math.min(x(t0) + 3, W - 30), y: H - 6 }); oggi.textContent = 'oggi'; g.append(oggi);
    const zero = svg('text', { x: m.s, y: H - 6 }); zero.textContent = 'ultima apertura'; g.append(zero);
    return crea('details', { classe: 'curva' }, crea('summary', { testo: 'La sua curva dell’oblio' }), g,
        crea('p', { classe: 'nota', testo: `Stabilità ${Math.round(v.stabilita)} giorni, ${v.accessi} ${v.accessi === 1 ? 'apertura' : 'aperture'}.` }));
}

// ---------------------------------------------------------------------------
// Azioni
// ---------------------------------------------------------------------------
async function apri(v) {
    const r = await comando('apri', v.id);
    if (!r.ok || !r.risultato?.apertura) return;
    const a = r.risultato.apertura;
    $('#titolo-apri').textContent = a.nome;
    $('#fonte-apri').textContent = `Fonte: ${a.fonte}`;
    $('#file-apri').textContent = a.file;
    $('#link-apri').href = a.url;
    const c = $('#contenuto-apri');
    if (a.testo !== undefined) c.replaceChildren(crea('pre', { testo: a.testo }));
    else if (/\.(jpe?g|png|gif|bmp)$/i.test(a.file)) c.replaceChildren(crea('img', { src: `${a.url}?t=${Date.now()}`, alt: a.ricostruito ? `Ricordo ricostruito di ${a.nome}, non originale` : `${a.nome}, originale` }));
    else c.replaceChildren(crea('p', { testo: 'Questo file non si può mostrare qui: aprilo dalla cartella dei ricordi.' }));
    $('#dialogo-apri').showModal();
}

function chiediDimentica(v) {
    const dlg = $('#dialogo-dimentica');
    $('#testo-dimentica').textContent = `Stai per dimenticare PER SEMPRE «${v.nome}»: chiavi distrutte, traccia cancellata, nessun ritorno.`;
    dlg.returnValue = '';
    dlg.onclose = () => { if (dlg.returnValue === 'si') comando('dimentica', v.id, { conferma: true }); };
    dlg.showModal();
}

async function cerca(testo) {
    testo = testo.trim();
    if (!testo) return annullaRicerca();
    const r = await comando('cerca', testo);
    if (!r.ok) return;
    const trovati = r.risultato?.trovati || [];
    risultatiRicerca = new Map(trovati.map(t => [t.id, t.dove]));
    $('#annulla-cerca').hidden = false;
    $('#esito-cerca').textContent = trovati.length
        ? `${trovati.length} ${trovati.length === 1 ? 'ricordo contiene' : 'ricordi contengono'} «${testo}».`
        : `Nessun ricordo contiene «${testo}».`;
    mostra(dati);
}

function annullaRicerca() {
    risultatiRicerca = null;
    $('#annulla-cerca').hidden = true;
    $('#esito-cerca').textContent = '';
    $('#campo-cerca').value = '';
    if (dati) mostra(dati);
}

async function affida(files) {
    if (!dati?.esiste) return avviso('Prima crea l’archivio.', true);
    const lista = [...files].filter(f => f.size >= 0 && !f.name.startsWith('.'));
    let ok = 0, falliti = 0;
    for (const f of lista) {
        // Una cartella trascinata arriva come un "file" che non si può leggere: senza questo
        // controllo fetch fallirebbe e la pagina direbbe che il server non risponde.
        if (!(await f.slice(0, 1).arrayBuffer().then(() => true, () => false))) {
            falliti++;
            scriviDiario([{ testo: `  Errore: «${f.name}» è una cartella o un file che non si può leggere: trascina i file che contiene.`, colore: 'Red' }], `oblio aggiungi ${f.name}`);
            continue;
        }
        avviso(`Affido all’oblio ${f.name}…`);
        const r = await chiama(`/api/aggiungi?nome=${encodeURIComponent(f.name)}&modificato=${f.lastModified || ''}`, { method: 'POST', body: f });
        scriviDiario(r.messaggi, `oblio aggiungi ${f.name}`);
        if (r.ok) { ok++; if (r.stato) mostra(r.stato); } else { falliti++; scriviDiario([{ testo: `  Errore: ${r.errore}`, colore: 'Red' }]); }
    }
    const fatti = ok === 1 ? '1 file affidato all’oblio.' : `${ok} file affidati all’oblio.`;
    avviso(falliti ? `${fatti} Non riusciti: ${falliti} (i motivi sono nel Diario).` : fatti, falliti > 0);
}

// ---------------------------------------------------------------------------
// Diario e avvisi
// ---------------------------------------------------------------------------
function scriviDiario(righe, titolo) {
    if (!righe?.length && !titolo) return;
    const diario = $('#diario');
    const nuove = [];
    if (titolo) nuove.push(crea('li', { classe: 'separatore', 'aria-hidden': 'true' }), crea('li', { classe: 'col-Magenta', testo: `$ ${titolo}` }));
    for (const r of righe || []) {
        for (const riga of String(r.testo).split('\n')) {
            if (!riga.trim() && !nuove.length) continue;
            nuove.push(crea('li', { classe: r.colore ? `col-${r.colore}` : '', testo: riga || ' ' }));
        }
    }
    diario.append(...nuove);
    diario.scrollTop = diario.scrollHeight;
}

let timerAvviso;
function avviso(testo, errore = false) {
    const el = $('#avviso');
    el.textContent = testo;
    el.classList.toggle('errore', errore);
    el.classList.add('visibile');
    clearTimeout(timerAvviso);
    timerAvviso = setTimeout(() => el.classList.remove('visibile'), errore ? 6000 : 3000);
}

// ---------------------------------------------------------------------------
// Collegamenti
// ---------------------------------------------------------------------------
function collega() {
    const slider = $('#giorni');
    const uscita = $('#giorni-uscita');
    const aggiornaSlider = () => {
        const g = Number(slider.value);
        uscita.textContent = g === 1 ? '1 giorno' : `${g} giorni`;
        slider.setAttribute('aria-valuetext', uscita.textContent);
    };
    slider.addEventListener('input', aggiornaSlider);
    aggiornaSlider();
    $('#modulo-tempo').addEventListener('submit', e => { e.preventDefault(); comando('tempo', String(slider.value)); });
    for (const b of document.querySelectorAll('[data-giorni]')) b.addEventListener('click', () => comando('tempo', b.dataset.giorni));
    $('#torna-oggi').addEventListener('click', () => comando('tempo', 'reset'));
    for (const r of document.querySelectorAll('input[name="velocita"]')) {
        r.addEventListener('change', () => { if (r.checked && String(dati?.velocita).toLowerCase() !== r.value) comando('velocita', r.value); });
    }
    $('#modulo-cerca').addEventListener('submit', e => { e.preventDefault(); cerca($('#campo-cerca').value); });
    $('#annulla-cerca').addEventListener('click', annullaRicerca);

    const scegli = $('#scegli-file');
    scegli.addEventListener('change', () => { affida(scegli.files); scegli.value = ''; });
    $('#etichetta-scegli').addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scegli.click(); }
    });

    // Trascinare file ovunque nella pagina
    const deposito = $('#deposito');
    let profondita = 0;
    const haFile = e => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', e => { if (!haFile(e)) return; profondita++; document.body.classList.add('trascina'); });
    window.addEventListener('dragleave', () => { profondita = Math.max(0, profondita - 1); if (!profondita) document.body.classList.remove('trascina'); });
    window.addEventListener('dragover', e => { if (haFile(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('drop', e => {
        if (!haFile(e)) return;
        e.preventDefault();
        profondita = 0;
        document.body.classList.remove('trascina');
        deposito.classList.remove('sopra');
        affida(e.dataTransfer.files);
    });
    deposito.addEventListener('dragenter', () => deposito.classList.add('sopra'));
    deposito.addEventListener('dragleave', () => deposito.classList.remove('sopra'));
}

collega();
carica();

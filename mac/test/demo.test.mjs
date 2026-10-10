// La demo: stessi file di prova della versione Windows e stessa storia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { preparaFileDiProva, eseguiDemo, DATE } from '../lib/demo.mjs';
import { decodifica, sipsDisponibile } from '../lib/sips.mjs';
import { cartellaTemporanea, pulisci, contesto, DEMO_WINDOWS } from './aiuto.mjs';
import { statoVoce } from '../lib/modello.js';

const conSips = { skip: !sipsDisponibile() && 'sips non disponibile' };

test('i file di prova sono quelli della demo Windows (stesso System.Random, seme 42)', conSips, () => {
    const base = cartellaTemporanea();
    try {
        preparaFileDiProva(base);
        assert.deepEqual(fs.readdirSync(base).sort(), Object.keys(DATE).sort());
        const backup = fs.readFileSync(path.join(base, 'backup-vecchio.bin'));
        assert.equal(backup.length, 1572864);
        // la stessa impronta registrata nella demo Windows: "impronta b69427aab97b…"
        assert.equal(createHash('sha256').update(backup).digest('hex').slice(0, 12), 'b69427aab97b');
        const win = JSON.parse(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'stato.json'), 'utf8'));
        assert.ok(win.voci.find(v => v.nome === 'backup-vecchio.bin').descrizione.includes('b69427aab97b'));
        for (const nome of ['mare.jpg', 'bosco.jpg', 'tramonto.png']) {
            const img = decodifica(fs.readFileSync(path.join(base, nome)));
            assert.deepEqual([img.larghezza, img.altezza], [2400, 1600], nome);
        }
        const d = fs.statSync(path.join(base, 'mare.jpg')).mtime;
        assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 7, 12, 18, 30]);
    } finally { pulisci(base); }
});

test('la storia completa: stessi stati finali della demo Windows', conSips, () => {
    const base = cartellaTemporanea();
    const cartella = path.join(base, 'demo');
    try {
        const { archivio, uscita } = eseguiDemo({ cartella });
        const testo = uscita.righe.map(r => r.testo).join('\n');
        for (const titolo of ['1 · Affido a Oblio sette file', '2 · Passano 90 giorni', '3 · Passano altri 60 giorni',
            '4 · Riapro la foto del mare', '5 · Passa un anno.', '6 · Cerco "mare"', '7 · Cosa resta del bosco', 'Fine']) {
            assert.ok(testo.includes(`━━━ ${titolo}`), titolo);
        }
        assert.match(testo, /7 file affidati all'oblio\./);
        assert.match(testo, /fattura-luce-settembre\.… testo {5}3 strati · 152 B · fissato: valore legale \(nome\)/);

        const mac = contesto(archivio).stato;
        const win = JSON.parse(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'stato.json'), 'utf8'));
        assert.equal(mac.offsetGiorni, 515);
        for (const w of win.voci) {
            const m = mac.voci.find(v => v.nome === w.nome);
            assert.ok(m, w.nome);
            assert.equal(statoVoce(m), statoVoce(w), `${w.nome}: stato`);
            assert.deepEqual(m.strati.map(s => [s.nome, s.vivo, s.dettaglio]), w.strati.map(s => [s.nome, s.vivo, s.dettaglio]), `${w.nome}: strati`);
            assert.equal(m.stabilita, w.stabilita, `${w.nome}: stabilità`);
            assert.equal(m.accessi, w.accessi, `${w.nome}: accessi`);
            assert.equal(m.fissato, w.fissato, `${w.nome}: fissato`);
            if (w.tipo !== 'immagine') assert.equal(m.descrizione, w.descrizione, `${w.nome}: descrizione`);
            else assert.equal(m.descrizione.split(';')[0], w.descrizione.split(';')[0], `${w.nome}: descrizione`);
        }
        // i ricordi da confrontare
        const ricordi = fs.readdirSync(path.join(archivio, 'ricordi')).sort();
        assert.deepEqual(ricordi, fs.readdirSync(path.join(DEMO_WINDOWS, 'ricordi')).sort());
        assert.equal(fs.readFileSync(path.join(archivio, 'ricordi', 'diario-estate.ricordo.txt'), 'utf8'),
            fs.readFileSync(path.join(DEMO_WINDOWS, 'ricordi', 'diario-estate.ricordo.txt'), 'utf8'));
        assert.equal(fs.readdirSync(path.join(cartella, 'file-di-prova')).length, 0, '-Sposta ha svuotato la cartella dei file di prova');

        // rieseguirla ricrea tutto da capo
        eseguiDemo({ cartella });
        assert.equal(contesto(archivio).stato.voci.length, 7);
    } finally { pulisci(base); }
});

test('la demo non tocca una cartella che non ha creato lei', () => {
    const base = cartellaTemporanea();
    try {
        fs.writeFileSync(path.join(base, 'importante.txt'), 'non cancellarmi');
        assert.throws(() => eseguiDemo({ cartella: base }), /esiste ma non l'ha creata la demo: non la tocco/);
        assert.ok(fs.existsSync(path.join(base, 'importante.txt')));
    } finally { pulisci(base); }
});

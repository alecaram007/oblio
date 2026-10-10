// Regressioni della pagina trovate dalla seconda passata (provate in Chrome headless;
// qui si controlla il codice, perché la suite non avvia un browser).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MAC } from './aiuto.mjs';

const APP = fs.readFileSync(path.join(MAC, 'web', 'app.js'), 'utf8');
const funzione = nome => {
    const i = APP.indexOf(`function ${nome}(`);
    assert.ok(i >= 0, `manca ${nome}()`);
    return APP.slice(i, APP.indexOf('\n}\n', i));
};

test('pagina: dopo Fissa, Libera o Dimentica il fuoco della tastiera resta nel cassetto', () => {
    // prima: le schede venivano ridisegnate e il fuoco finiva sul <body>, in cima alla pagina
    assert.match(funzione('scheda'), /'data-id': v\.id/);
    const m = funzione('mostraCassetto');
    assert.match(m, /document\.activeElement/);
    assert.match(m, /\.focus\(\)/);
    assert.ok(m.indexOf('activeElement') < m.indexOf('replaceChildren(...voci'), 'il fuoco va ricordato prima di ridisegnare');
});

test('pagina: una cartella trascinata non fa dire "il server non risponde"', () => {
    const a = funzione('affida');
    assert.match(a, /\.slice\(0, 1\)\.arrayBuffer\(\)/, 'prova a leggere il file prima di caricarlo');
    assert.ok(a.indexOf('arrayBuffer') < a.indexOf("chiama("), 'il controllo viene prima del caricamento');
    assert.match(a, /è una cartella/);
    assert.match(a, /falliti > 0\)/, "l'avviso finale non nasconde i caricamenti falliti");
});

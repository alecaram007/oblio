// Cifratura per strato: AES-256-CBC + HMAC-SHA256, compatibile con la versione Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, createDecipheriv } from 'node:crypto';

import { nuovaChiave, proteggiStrato, sproteggiStrato } from '../lib/cifra.mjs';
import { DEMO_WINDOWS } from './aiuto.mjs';

test('andata e ritorno, con un IV nuovo ogni volta', () => {
    const k = nuovaChiave();
    assert.equal(k.length, 64);
    for (const n of [0, 1, 15, 16, 17, 1000, 100000]) {
        const dati = Buffer.alloc(n, 7);
        const p = proteggiStrato(dati, k);
        // IV (16) + cifrato con riempimento PKCS#7 + HMAC (32)
        assert.equal(p.length, 16 + (Math.floor(n / 16) + 1) * 16 + 32);
        assert.deepEqual(sproteggiStrato(p, k), dati);
    }
    const a = proteggiStrato(Buffer.from('ciao'), k), b = proteggiStrato(Buffer.from('ciao'), k);
    assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16));
});

test('formato del pacchetto: IV ‖ AES-256-CBC(chiave[0..32]) ‖ HMAC-SHA256(chiave[32..64], IV ‖ cifrato)', () => {
    const k = nuovaChiave();
    const dati = Buffer.from('Il mare quella sera era calmo.');
    const p = proteggiStrato(dati, k);
    const corpo = p.subarray(0, p.length - 32);
    assert.deepEqual(p.subarray(p.length - 32), createHmac('sha256', k.subarray(32)).update(corpo).digest());
    const d = createDecipheriv('aes-256-cbc', k.subarray(0, 32), corpo.subarray(0, 16));
    assert.deepEqual(Buffer.concat([d.update(corpo.subarray(16)), d.final()]), dati);
});

test('l\'HMAC rileva ogni manomissione', () => {
    const k = nuovaChiave();
    const p = proteggiStrato(Buffer.from('dati importanti da non toccare'), k);
    for (const pos of [0, 15, 16, 20, p.length - 33, p.length - 1]) {
        const rotto = Buffer.from(p);
        rotto[pos] ^= 0x01;
        assert.throws(() => sproteggiStrato(rotto, k), /strato manomesso o chiave sbagliata/, `byte ${pos}`);
    }
    assert.throws(() => sproteggiStrato(p, nuovaChiave()), /strato manomesso o chiave sbagliata/);
    assert.throws(() => sproteggiStrato(p.subarray(0, 63), k), /strato corrotto/);
    assert.throws(() => sproteggiStrato(Buffer.concat([p, Buffer.from([0])]), k), /strato manomesso/);
});

test('decifra gli strati scritti dalla versione Windows (demo originale)', () => {
    const chiavi = JSON.parse(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'chiavi.json'), 'utf8'));
    const ids = Object.keys(chiavi);
    assert.equal(ids.length, 11);
    for (const id of ids) {
        const chiave = Buffer.from(chiavi[id], 'base64');
        assert.equal(chiave.length, 64);
        const dati = sproteggiStrato(fs.readFileSync(path.join(DEMO_WINDOWS, '.oblio', 'strati', `${id}.bin`)), chiave);
        if (/media|miniatura/.test(id)) assert.deepEqual([...dati.subarray(0, 3)], [0xff, 0xd8, 0xff], `${id} è un JPEG`);
        else assert.ok(dati.toString('utf8').length > 10, id);
    }
});

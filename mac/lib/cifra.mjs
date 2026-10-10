// Cifratura: ogni strato ha la sua chiave (AES-256-CBC + HMAC-SHA256).
// Formato identico alla versione Windows:
//   chiave   = 64 byte casuali: i primi 32 per AES-256, gli ultimi 32 per HMAC-SHA256
//   pacchetto = IV (16 byte) ‖ testo cifrato (CBC, riempimento PKCS#7) ‖ HMAC-SHA256(IV ‖ cifrato) (32 byte)

import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

export function nuovaChiave() {
    return randomBytes(64);
}

export function proteggiStrato(dati, chiave) {
    const iv = randomBytes(16);
    const aes = createCipheriv('aes-256-cbc', chiave.subarray(0, 32), iv);
    const cifrato = Buffer.concat([aes.update(dati), aes.final()]);
    const corpo = Buffer.concat([iv, cifrato]);
    const tag = createHmac('sha256', chiave.subarray(32, 64)).update(corpo).digest();
    return Buffer.concat([corpo, tag]);
}

export function sproteggiStrato(pacchetto, chiave) {
    const n = pacchetto.length;
    if (n < 64) throw new Error('strato corrotto');
    const corpo = pacchetto.subarray(0, n - 32);
    const tag = pacchetto.subarray(n - 32);
    const atteso = createHmac('sha256', chiave.subarray(32, 64)).update(corpo).digest();
    if (!timingSafeEqual(atteso, tag)) throw new Error('strato manomesso o chiave sbagliata');
    const aes = createDecipheriv('aes-256-cbc', chiave.subarray(0, 32), corpo.subarray(0, 16));
    return Buffer.concat([aes.update(corpo.subarray(16)), aes.final()]);
}

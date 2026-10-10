// La data di scatto scritta dalla fotocamera (EXIF DateTimeOriginal, tag 36867).
// Modulo condiviso tra Node e browser: nessun import di node:*.

export function dataScatto(dati) {
    try {
        const b = dati instanceof Uint8Array ? dati : new Uint8Array(dati);
        if (b[0] !== 0xff || b[1] !== 0xd8) return null;
        let p = 2;
        while (p + 4 < b.length) {
            if (b[p] !== 0xff) return null;
            const marcatore = b[p + 1];
            if (marcatore === 0xd9 || marcatore === 0xda) return null;
            const lunghezza = (b[p + 2] << 8) | b[p + 3];
            if (marcatore === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
                return leggiTiff(b, p + 10, p + 2 + lunghezza);
            }
            p += 2 + lunghezza;
        }
    } catch { /* EXIF rovinato: si usa la data del file */ }
    return null;
}

function leggiTiff(b, base, fine) {
    const piccolo = b[base] === 0x49;
    const u16 = o => piccolo ? b[base + o] | (b[base + o + 1] << 8) : (b[base + o] << 8) | b[base + o + 1];
    const u32 = o => piccolo
        ? (b[base + o] | (b[base + o + 1] << 8) | (b[base + o + 2] << 16)) + b[base + o + 3] * 16777216
        : b[base + o] * 16777216 + ((b[base + o + 1] << 16) | (b[base + o + 2] << 8) | b[base + o + 3]);
    const cercaTag = (ifd, tag) => {
        if (base + ifd + 2 > fine) return null;
        const n = u16(ifd);
        for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            if (base + e + 12 > fine) return null;
            if (u16(e) === tag) return { tipo: u16(e + 2), quanti: u32(e + 4), valore: u32(e + 8), pos: e + 8 };
        }
        return null;
    };
    const ifd0 = u32(4);
    let voce = cercaTag(ifd0, 0x9003);
    if (!voce) {
        const exif = cercaTag(ifd0, 0x8769);
        if (!exif) return null;
        voce = cercaTag(exif.valore, 0x9003);
    }
    if (!voce || voce.tipo !== 2) return null;
    const inizio = voce.quanti > 4 ? voce.valore : voce.pos;
    let s = '';
    for (let i = 0; i < voce.quanti && base + inizio + i < fine; i++) {
        const c = b[base + inizio + i];
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    // come ParseExact di .NET: una data impossibile ("0000:00:00 00:00:00", che molte
    // fotocamere scrivono quando non sanno la data, o il 30 febbraio) non vale, si usa la data del file
    const [a, me, g, h, mi, se] = m.slice(1).map(Number);
    const d = new Date(2000, 0, 1);
    d.setFullYear(a, me - 1, g);   // setFullYear: l'anno 99 resta 99, non diventa 1999
    d.setHours(h, mi, se, 0);
    if (a < 1 || d.getFullYear() !== a || d.getMonth() !== me - 1 || d.getDate() !== g || h > 23 || mi > 59 || se > 59) return null;
    return d;
}

// Una copia fedele di System.Random di .NET Framework (algoritmo sottrattivo di Knuth).
// Con lo stesso seme dà gli stessi numeri della demo Windows: le foto di prova
// vengono uguali e il "vecchio backup" ha la stessa impronta.
// Modulo condiviso tra Node e browser: nessun import di node:*.

const MBIG = 2147483647;
const MSEED = 161803398;

export class CasualeNet {
    constructor(seme) {
        this.semi = new Array(56).fill(0);
        const sottrai = seme === -2147483648 ? MBIG : Math.abs(seme);
        let mj = MSEED - sottrai;
        this.semi[55] = mj;
        let mk = 1;
        for (let i = 1; i < 55; i++) {
            const ii = (21 * i) % 55;
            this.semi[ii] = mk;
            mk = mj - mk;
            if (mk < 0) mk += MBIG;
            mj = this.semi[ii];
        }
        for (let k = 1; k < 5; k++) {
            for (let i = 1; i < 56; i++) {
                this.semi[i] -= this.semi[1 + (i + 30) % 55];
                if (this.semi[i] < 0) this.semi[i] += MBIG;
            }
        }
        this.inext = 0;
        this.inextp = 21;
    }

    campione() {
        let a = this.inext, b = this.inextp;
        if (++a >= 56) a = 1;
        if (++b >= 56) b = 1;
        let r = this.semi[a] - this.semi[b];
        if (r === MBIG) r--;
        if (r < 0) r += MBIG;
        this.semi[a] = r;
        this.inext = a;
        this.inextp = b;
        return r;
    }

    // Next(), Next(max), Next(min, max): max escluso.
    prossimo(min, max) {
        if (min === undefined) return this.campione();
        if (max === undefined) { max = min; min = 0; }
        const intervallo = max - min;
        return Math.trunc(this.campione() * (1.0 / MBIG) * intervallo) + min;
    }

    byte(n) {
        const out = new Uint8Array(n);
        for (let i = 0; i < n; i++) out[i] = this.campione() % 256;
        return out;
    }
}

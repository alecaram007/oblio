// La riga di comando: lettura degli argomenti e colori del terminale.

import { esegui, Uscita, messaggioErrore } from './archivio.mjs';


// I colori di Write-Host, tradotti in sequenze ANSI (solo se l'uscita è un terminale).
const ANSI = { White: '97', Gray: '37', DarkGray: '90', Cyan: '96', Yellow: '93', Red: '91', Green: '92', Magenta: '95' };
const conColori = (flusso) => Boolean(flusso.isTTY) && !process.env.NO_COLOR;

export function scrittore(flusso = process.stdout) {
    const colori = conColori(flusso);
    return (testo, colore) => {
        if (colori && colore && ANSI[colore]) flusso.write(`\x1b[${ANSI[colore]}m${testo}\x1b[0m\n`);
        else flusso.write(`${testo}\n`);
    };
}

// Come PowerShell: due argomenti posizionali (comando, argomento), interruttori
// -Sposta -Conferma -Mostra e l'opzione -Archivio. Accetta anche --archivio,
// --archivio=<cartella>, maiuscole o minuscole indifferentemente.
export function leggiArgomenti(argv) {
    const posizionali = [];
    const opzioni = { archivio: undefined, sposta: false, conferma: false, mostra: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (/^-{1,2}[A-Za-zÀ-ÿ]/.test(a) && a !== '-h') {
            let [nome, valore] = a.replace(/^-{1,2}/, '').split(/[=:](.*)/s);
            nome = nome.toLowerCase();
            if (nome === 'archivio') {
                if (valore === undefined) {
                    valore = argv[++i];
                    if (valore === undefined) throw new Error("Manca la cartella dopo -Archivio.");
                }
                opzioni.archivio = valore;
            } else if (['sposta', 'conferma', 'mostra'].includes(nome)) {
                opzioni[nome] = valore === undefined ? true : !/^(\$?false|0|no)$/i.test(valore);
            } else if (nome === 'help' || nome === 'aiuto') {
                posizionali.unshift('aiuto');
            } else {
                throw new Error(`Opzione sconosciuta: '${a}'. Scrivi:  oblio aiuto`);
            }
        } else {
            posizionali.push(a);
        }
    }
    if (posizionali.length > 2) {
        throw new Error(`Troppi argomenti: '${posizionali.slice(2).join(' ')}'. Se un nome contiene spazi, mettilo tra virgolette.`);
    }
    return { comando: posizionali[0] || 'aiuto', argomento: posizionali[1] || '', opzioni };
}

export function principale(argv = process.argv.slice(2)) {
    const uscita = new Uscita(scrittore(process.stdout));
    try {
        const { comando, argomento, opzioni } = leggiArgomenti(argv);
        esegui(comando, argomento, opzioni, uscita);
        return 0;
    } catch (e) {
        scrittore(process.stderr)(`  Errore: ${messaggioErrore(e)}`, 'Red');
        return 1;
    }
}


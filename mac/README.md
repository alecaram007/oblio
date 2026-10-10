# Oblio per Mac

**Il file system che dimentica come un essere umano**, rifatto per il Mac.

È la stessa Oblio della versione Windows (`../src/oblio.ps1`), riscritta in Node.js puro: stessi comandi, stessi messaggi, stessa curva dell'oblio, stessa cifratura per strato e stessi file su disco. In più c'è un'interfaccia web: l'archivio diventa un cassetto della memoria, dove i ricordi sbiadiscono davanti ai tuoi occhi.

Non serve installare niente oltre a Node.js (versione 20 o successiva). Non ci sono pacchetti npm: solo i moduli integrati di Node e `sips`, lo strumento per le immagini che macOS ha già.

## Provalo subito

- **Doppio clic su `avvia.command`**: si accende il server e si apre il browser su <http://localhost:5178>. Se la demo non è mai stata eseguita, la prepara da sola.
- **Doppio clic su `demo.command`**: la demo della versione Windows, uguale. Crea sette file di prova (tre foto dipinte al computer, tre testi tra cui una fattura, un vecchio backup), li affida a Oblio e simula più di un anno, riaprendo solo alcuni file. Alla fine trovi i ricordi ricostruiti in `demo/archivio/ricordi`: confronta `mare.ricordo.jpg`, ricostruito da 480 px, con `bosco.ricordo.jpg`, ricostruito da appena 64 px.
- **Doppio clic su `test.command`**: esegue tutti i test.

La prima volta macOS potrebbe chiedere conferma per aprire un file `.command` scaricato: clic destro → *Apri*.

Da terminale, nella cartella `mac`:

```
npm start            l'interfaccia web (porta 5178, oppure PORT=...)
npm run demo         la demo
npm test             i test (node --test)
node bin/oblio.mjs   la riga di comando
```

## La riga di comando

```
node bin/oblio.mjs crea                              crea ./archivio-oblio
node bin/oblio.mjs aggiungi ~/Pictures/estate        affida i file all'oblio (copia; -Sposta per spostarli)
node bin/oblio.mjs stato                             cosa è nitido, cosa sbiadisce, cosa è solo traccia
node bin/oblio.mjs apri mare.jpg -Mostra             ricostruisce il file in /ricordi e lo riconsolida
node bin/oblio.mjs cerca mare                        cerca anche nei file dimenticati (nelle tracce)
node bin/oblio.mjs fissa contratto.pdf               rende un file indimenticabile
node bin/oblio.mjs libera contratto.pdf              lo restituisce all'oblio
node bin/oblio.mjs dimentica foto.jpg -Conferma      oblio immediato e totale
node bin/oblio.mjs velocita elefante                 elefante | normale | pesce-rosso
node bin/oblio.mjs tempo 90                          simula il passare di 90 giorni (tempo reset per tornare a oggi)
node bin/oblio.mjs domani                            novità: cosa sbiadirà nei prossimi 30 giorni (domani 90 per 90 giorni)
```

`./oblio.command <comando>` fa lo stesso. Per scrivere solo `oblio`, aggiungi un alias al tuo `~/.zshrc`:

```
alias oblio='node "/percorso/di/oblio/mac/bin/oblio.mjs"'
```

Ogni comando accetta `-Archivio <cartella>`, come su Windows, e anche la forma Unix `--archivio <cartella>` o `--archivio=<cartella>`. In alternativa c'è la variabile d'ambiente `OBLIO_ARCHIVIO`. Gli interruttori si scrivono `-Sposta`, `-Conferma`, `-Mostra` (oppure `--sposta`, `--conferma`, `--mostra`); maiuscole e minuscole non contano. `-Mostra` apre il ricordo con l'applicazione predefinita del Mac (`open`).

Gli errori escono come `  Errore: ...` sullo standard error, con codice di uscita 1. I colori compaiono solo nel terminale (e mai se è impostata `NO_COLOR`).

## L'interfaccia web

`npm start` (o `avvia.command`) avvia `server.mjs`, che ascolta solo su `127.0.0.1`, porta `5178` o quella della variabile `PORT`. L'archivio è quello indicato con `node server.mjs --archivio <cartella>`, oppure da `OBLIO_ARCHIVIO`, altrimenti quello della demo Mac (`demo/archivio`).

Nella pagina:

- ogni file è una **scheda** con la barra di vitalità (e le soglie degli strati), lo stato (nitido, sbiadito, essenza, traccia), cosa resta, quando avverrà il prossimo oblio e gli strati già persi;
- l'**anteprima è il ricordo vero**: le immagini mostrano lo strato che resta, quindi a 64 px si sgranano davvero; i testi mostrano il riassunto o l'essenza; di una traccia resta solo la descrizione;
- **Apri**, **Fissa**/**Libera**, **Dimentica** (con una finestra di conferma): sono gli stessi comandi della riga di comando, con gli stessi messaggi, raccolti nel *Diario di Oblio* in fondo alla pagina;
- lo **slider** e le scorciatoie (+1 settimana, +1 mese, +3 mesi, +1 anno, Torna a oggi) fanno passare il tempo; la **velocità** si sceglie con tre pulsanti;
- la **ricerca** guarda nel nome, nelle tracce e nel testo degli strati rimasti;
- **trascina dei file** ovunque nella pagina (o sceglili dal Mac) per affidarli all'oblio;
- il riquadro **Nei prossimi 30 giorni** dice cosa sbiadirà se non riapri nulla;
- ogni scheda ha la sua **curva dell'oblio** disegnata con lo stesso modulo (`lib/modello.js`) che usa la riga di comando.

La pagina funziona offline (niente CDN), si usa bene anche a 375 px di larghezza, segue il tema chiaro o scuro del Mac, ed è navigabile da tastiera.

Il server rifiuta le richieste che cambiano l'archivio se arrivano da un altro sito, e serve al browser solo i moduli del nucleo che non toccano disco e chiavi.

## Come funziona

È tutto come nella versione Windows: leggi anche il `README.md` della cartella principale.

| Tipo | Strati, dal più dettagliato al più povero | Resta finché la vitalità è ≥ |
|---|---|---|
| Immagine | originale → media (480 px) → miniatura (64 px) → descrizione | 0,50 → 0,20 → 0,05 → sempre |
| Testo (anche PDF, .docx, .odt con testo) | originale → riassunto (~30% delle frasi) → essenza (1 frase + parole chiave) → descrizione | 0,50 → 0,20 → 0,05 → sempre |
| Altro | originale → descrizione | 0,20 → sempre |

- Vitalità `R = e^(−t / S)`; `S` vale 180 giorni × il fattore di velocità (elefante 4, normale 1, pesce rosso 0,25). Ogni apertura moltiplica `S` per 2,5, fino a 10 anni.
- Ogni strato è cifrato con una chiave propria da 64 byte: AES-256-CBC con i primi 32 byte, HMAC-SHA256 sugli ultimi 32. Il file dello strato è `IV ‖ cifrato ‖ HMAC(IV ‖ cifrato)`. Dimenticare uno strato vuol dire distruggerne la chiave.
- Un ricordo ricostruito è sempre marcato: le immagini con la fascia «RICORDO RICOSTRUITO · NON ORIGINALE · da 64×43 px», i testi con un'intestazione.
- Fatture, contratti, scontrini, garanzie, bollette, F24, 730, CUD... vengono fissati da soli, riconosciuti dal nome o dal contenuto (partita IVA, IBAN, "totale da pagare", codice fiscale...).

## Com'è fatto

```
mac/
  bin/oblio.mjs        la riga di comando (tutti i comandi e le opzioni dell'originale)
  bin/demo.mjs         la demo
  server.mjs           il server web (nessuna dipendenza)
  web/                 la pagina: index.html, stile.css, app.js, icona.svg
  lib/                 il nucleo, in moduli ES
    archivio.mjs         comandi, archivio su disco, strati (Node)
    cifra.mjs            AES-256-CBC + HMAC-SHA256 (node:crypto)
    sips.mjs             il ponte con sips per leggere e scrivere JPEG, PNG, GIF, TIFF, HEIC
    estrai.mjs           testo da PDF, .docx, .odt (node:zlib)
    cli.mjs, demo.mjs    riga di comando e demo
    modello.js           curva dell'oblio, soglie, previsioni      ← anche nel browser
    formato.js           numeri, byte e date all'italiana          ← anche nel browser
    testo.js             riassunto estrattivo, documenti da fissare
    immagine.js          BMP, ridimensionamento bicubico, colori, fascia
    font.js              un carattere bitmap 5×7 disegnato a mano
    disegno.js           un piccolo pittore per le foto della demo
    casuale.js           una copia di System.Random di .NET
    exif.js              la data di scatto delle foto
  test/                node --test
  demo/                creata dalla demo, non è nel repository (la demo Windows in ../demo non si tocca)
  *.command            lanciatori con doppio clic
```

I moduli `.js` di `lib/` non importano niente da `node:*`: potrebbero girare anche nel browser (la pagina usa `formato.js` e `modello.js`). I moduli `.mjs` usano Node.

## Compatibilità con la versione Windows

- `stato.json` e `chiavi.json` hanno gli stessi campi e lo stesso significato. Un archivio creato su Windows si apre sul Mac e viceversa (portando con sé `chiavi.json`, come sempre). I test lo verificano su una copia dell'archivio della demo Windows: lo leggono, ne decifrano ogni strato, ricostruiscono `mare.jpg` e `diario-estate.txt` (il ricordo del diario esce identico byte per byte a quello prodotto su Windows).
- Il riassunto e l'essenza dei testi sono identici a quelli calcolati da PowerShell (verificato sugli strati della demo Windows).
- La demo usa lo stesso generatore casuale di .NET con lo stesso seme: il "vecchio backup" ha la stessa impronta (`b69427aab97b…`) e alla fine ogni file è nello stesso stato, con gli stessi strati e la stessa stabilità della demo Windows.
- I messaggi sono gli stessi, carattere per carattere, salvo i separatori dei percorsi: `./archivio-oblio` e `/ricordi` al posto di `.\archivio-oblio` e `\ricordi`.
- I file di testo ricostruiti sono in UTF-8 con BOM e a capo CRLF, come su Windows.

## Differenze dalla versione Windows

- **Immagini.** Su Windows lavorava System.Drawing. Qui `sips` decodifica e codifica (passando per il BMP) e tutto il resto è JavaScript: il ridimensionamento bicubico con filtro allargato (Catmull-Rom per rimpicciolire, Mitchell per ingrandire, bordi riflessi), i nomi dei colori calcolati con le stesse formule di `Color.GetHue/GetSaturation/GetBrightness`, la fascia scura al 69%. Il risultato è molto simile ma non identico al pixel: i JPEG di sips hanno pesi diversi da quelli di GDI+, e le descrizioni possono differire di poco (nella demo il tramonto è "nero, rosso, arancione" invece di "nero, arancione, rosso").
- **La fascia** usa un carattere bitmap disegnato a mano (5×7, ingrandito con i bordi sfumati), non Segoe UI: è leggibile e non dipende dai font installati, ma è più "da terminale".
- **File nascosti.** Aggiungendo una cartella si saltano i file e le cartelle che iniziano con un punto (`.DS_Store` e simili), come Windows saltava i file nascosti.
- **Errori.** Se un comando fallisce, ciò che il tempo aveva già dimenticato prima del comando viene comunque salvato (su Windows lo strato spariva dal disco ma la chiave restava in `chiavi.json` fino al comando successivo). `dimentica -Conferma` distrugge anche eventuali chiavi rimaste di strati già persi.
- **Argomenti in più.** Su Windows PowerShell rifiutava gli argomenti di troppo con un suo messaggio; qui il messaggio è in italiano e suggerisce di usare le virgolette per i nomi con spazi.

## Novità rispetto alla versione Windows

1. **L'interfaccia web**, descritta sopra: il cassetto della memoria, con le immagini che si sgranano davvero, il tempo che scorre con uno slider e i file da trascinare.
2. **Testo da PDF, Word e OpenDocument.** Nel README originale era un limite: PDF e .docx venivano trattati come binari (solo originale e descrizione). Ora se un `.pdf`, un `.docx` o un `.odt` contiene testo leggibile, sbiadisce come un testo (riassunto, essenza) e viene fissato da solo se il contenuto è quello di una fattura o di un contratto. La ricerca guarda dentro il documento originale. Il `.docx` è uno zip, aperto con `node:zlib`; il PDF è letto a mano (flussi compressi, oggetti compressi, tabelle ToUnicode, codifiche WinAnsi e MacRoman). L'originale resta il file vero, quindi un archivio con questi documenti si apre ancora su Windows.
3. **Anteprima del domani.** `oblio domani [giorni]` (e il riquadro nella pagina) dice cosa sbiadirà nei prossimi giorni se non riapri nulla, e in cosa si trasformerà. Non cambia niente: è una previsione, per salvare in tempo un ricordo riaprendolo o fissandolo.

Tutte le novità sono coperte dai test (`test/estrai.test.mjs`, `test/modello.test.mjs`, `test/archivio.test.mjs`, `test/server.test.mjs`).

## Limiti onesti

- **Serve un Mac per le immagini.** Senza `sips` (per esempio su Linux) le immagini vengono trattate come file binari; i BMP si leggono comunque. Tutto il resto funziona ovunque giri Node.
- **Le chiavi stanno in un file JSON**, come su Windows. Su un SSD cancellare un file non garantisce che i byte spariscano davvero; una versione vera terrebbe le chiavi nel Secure Enclave del Mac.
- **Non è un file system vero**: è un archivio gestito da riga di comando e dal browser. Il passo successivo sarebbe un'estensione del Finder (File Provider) per vedere i file sbiadire lì.
- **I PDF "semplici"**: niente OCR, quindi le scansioni restano binarie; i font con codifiche personalizzate (`/Differences`) senza tabella ToUnicode possono dare testo incompleto, e in quel caso il documento resta binario.
- **La ricostruzione non usa IA generativa** e **le descrizioni delle immagini si basano sui colori**, come nella versione Windows.
- **Il server è per una persona sola**, sul proprio Mac: niente account, niente HTTPS, ascolta solo su 127.0.0.1. I file trascinati nella pagina arrivano interi in memoria (fino a 512 MB ciascuno).
- **I messaggi del Diario** nella pagina sono quelli della riga di comando, quindi parlano ancora di `-Conferma` e `-Sposta`.

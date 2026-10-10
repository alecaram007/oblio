# Oblio

Oblio è un prototipo di archivio di file che dimentica come un essere umano: i file che non riapri sbiadiscono un po' alla volta, quelli che riapri si rafforzano.
Per provarlo su Mac fai doppio clic su `mac/avvia.command` (serve Node.js 20 o successivo); su Windows fai doppio clic su `demo.cmd`.

**Il file system che dimentica come un essere umano.**

I computer di oggi conoscono solo due stati: ricordano tutto alla perfezione oppure cancellano. Oblio aggiunge una via di mezzo, cioè una memoria che **sbiadisce**. Le cose che non riapri perdono dettaglio un po' alla volta, finché di loro resta solo una traccia. Le cose che riapri, invece, si rafforzano.

Questo è un prototipo funzionante per Windows e non richiede nessuna installazione, perché usa soltanto PowerShell 5.1 e .NET, già presenti nel sistema.

## Provalo subito

Fai doppio clic su **`demo.cmd`**.

La demo crea sette file di prova (tre foto, tre testi tra cui una fattura, un vecchio backup) e li affida a Oblio. Poi simula più di un anno, riaprendo solo alcuni file. Al termine trovi i ricordi ricostruiti in `demo\archivio\ricordi`. Vale la pena confrontare `mare.ricordo.jpg`, ricostruito da 480 px, con `bosco.ricordo.jpg`, ricostruito da appena 64 px.

Nel repository c'è già il risultato di una demo eseguita su Windows, in `demo\archivio`: si può guardare senza eseguire niente, e i test della versione Mac lo usano per verificare che gli archivi siano compatibili. Eseguire di nuovo `demo.cmd` lo ricrea da capo.

## Usarlo sui tuoi file

Apri un terminale in questa cartella:

```
oblio crea                              crea .\archivio-oblio
oblio aggiungi C:\percorso\cartella     affida i file all'oblio (copia; -Sposta per spostarli)
oblio stato                             cosa è nitido, cosa sbiadisce, cosa è solo traccia
oblio apri mare.jpg -Mostra             ricostruisce il file in \ricordi e lo riconsolida
oblio cerca mare                        cerca anche nei file dimenticati (nelle tracce)
oblio fissa contratto.pdf               rende un file indimenticabile
oblio libera contratto.pdf              lo restituisce all'oblio
oblio dimentica foto.jpg -Conferma      oblio immediato e totale
oblio velocita elefante                 elefante | normale | pesce-rosso
oblio tempo 90                          simula il passare di 90 giorni (tempo reset per tornare a oggi)
```

Ogni comando accetta `-Archivio <cartella>`. In alternativa puoi impostare la variabile d'ambiente `OBLIO_ARCHIVIO`.

## Come funziona

### 1. Ogni file diventa una pila di strati

| Tipo | Strati, dal più dettagliato al più povero | Resta finché la vitalità è ≥ |
|---|---|---|
| Immagine | originale → media (480 px) → miniatura (64 px) → descrizione | 0,50 → 0,20 → 0,05 → sempre |
| Testo | originale → riassunto (~30% delle frasi) → essenza (1 frase + parole chiave) → descrizione | 0,50 → 0,20 → 0,05 → sempre |
| Altro | originale → descrizione | 0,20 → sempre |

Il riassunto è **estrattivo** e viene calcolato sul posto. Oblio sceglie le frasi con le parole più frequenti e significative, e nessun testo esce dal computer.

### 2. La vitalità segue la curva dell'oblio di Ebbinghaus

```
R = e^(−t / S)
```

- `t` sono i giorni passati dall'ultima apertura.
- `S` è la stabilità: vale 180 giorni all'inizio e viene moltiplicata per il fattore di velocità.

Ogni apertura **moltiplica S per 2,5**, con un massimo di 10 anni. È il riconsolidamento: ripensare a un ricordo lo rafforza, proprio come nella ripetizione spaziata.

Ecco quanto dura ogni stato per un file che non viene mai riaperto:

| Velocità | Nitido | Sbiadito fino a | Essenza fino a |
|---|---|---|---|
| pesce-rosso | ~31 giorni | ~72 giorni | ~135 giorni |
| normale | ~125 giorni | ~290 giorni | ~539 giorni |
| elefante | ~499 giorni | ~3 anni | ~6 anni |

### 3. Dimenticare davvero: il crypto-shredding

Ogni strato è cifrato con **una chiave propria** (AES-256-CBC + HMAC-SHA256). Dimenticare uno strato significa **distruggerne la chiave**. Da quel momento lo strato è rumore, anche se una sua copia sopravvive in un backup o in un settore del disco. Il file cifrato viene poi cancellato per liberare spazio.

### 4. Ricordi ricostruiti, mai spacciati per originali

`apri` usa lo strato migliore rimasto. Se l'originale non c'è più, il risultato viene marcato in modo evidente: le immagini ricevono una fascia «RICORDO RICOSTRUITO · NON ORIGINALE», i testi un'intestazione. Un ricordo ricostruito non può passare per una prova.

### 5. Documenti indimenticabili

Fatture, contratti, scontrini, garanzie, bollette, F24, 730, CUD e documenti simili vengono **fissati automaticamente**. Oblio li riconosce dal nome del file oppure dal contenuto (partita IVA, IBAN, "totale da pagare"...).

## Com'è fatto l'archivio

```
archivio-oblio\
  .oblio\stato.json      voci, vitalità, orologio simulato
  .oblio\chiavi.json     una chiave per strato: se la chiave sparisce, lo strato è dimenticato
  .oblio\strati\<id>\    gli strati cifrati
  ricordi\               i file che hai riaperto
```

Se copi l'archivio da un'altra parte, porta con te anche `chiavi.json`. Senza quel file l'archivio è illeggibile, ed è proprio così che deve funzionare.

## Limiti del prototipo

- **Le chiavi stanno in un file JSON.** Su un SSD, cancellare un file non garantisce che i vecchi byte spariscano davvero. Una versione vera terrebbe le chiavi nel TPM o in un secure enclave, dove distruggerle è definitivo.
- **Non è ancora un driver di file system.** È un archivio gestito da riga di comando. Il passo successivo sarebbe un minifilter di Windows o un'estensione della Shell, in modo da vedere i file sbiadire direttamente in Esplora risorse.
- **La ricostruzione non usa IA generativa.** Le immagini vengono ingrandite con interpolazione bicubica, e per i testi si mostra ciò che resta. I punti in cui agganciare un modello sono segnati nel codice (`Open-Voce`).
- **Le descrizioni delle immagini si basano sui colori**, per esempio "azzurro, beige", e non su un modello di visione che direbbe "spiaggia con ombrellone rosso".
- **Formati di testo gestiti:** .txt, .md, .log e .csv. PDF, documenti Word e altri formati vengono trattati come binari, quindi hanno solo l'originale e la descrizione.

## Su Mac

C'è anche una versione per Mac, nella cartella `mac`: stessi comandi e stessi archivi, in Node.js puro, più un'interfaccia web. Fai doppio clic su `mac/avvia.command` (oppure `cd mac && npm run demo && npm start`) e si apre il browser; `mac/demo.command` esegue la demo. Tutti i dettagli sono in [mac/README.md](mac/README.md).

Licenza: da definire (per ora tutti i diritti riservati).

#!/bin/bash
# Avvia l'interfaccia web di Oblio e la apre nel browser.
# Archivio: --archivio <cartella>, la variabile OBLIO_ARCHIVIO, altrimenti la demo Mac (demo/archivio).
# Non cambia cartella: un percorso relativo come "--archivio ./mio" vale rispetto alla cartella
# in cui sei, come per oblio.command (e non finisce dentro mac/).
QUI="$(cd "$(dirname "$0")" && pwd)" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "  Serve Node.js (versione 20 o successiva): https://nodejs.org"
  read -r -p "  Premi Invio per chiudere." _
  exit 1
fi
PORTA="${PORT:-5178}"
if [ ! -f "$QUI/demo/archivio/.oblio/stato.json" ] && [ -z "$OBLIO_ARCHIVIO" ]; then
  echo "  Non c'è ancora l'archivio della demo: lo preparo (bastano pochi secondi)."
  node "$QUI/bin/demo.mjs" --veloce >/dev/null || exit 1
fi
PORT="$PORTA" node "$QUI/server.mjs" "$@" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORTA/"; then break; fi
  sleep 0.1
done
open "http://localhost:$PORTA"
wait $SERVER

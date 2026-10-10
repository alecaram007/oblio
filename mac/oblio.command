#!/bin/bash
# Oblio dalla riga di comando. Doppio clic: apre un terminale con l'aiuto.
# Da terminale:  ./oblio.command stato -Archivio ~/archivio-oblio
# Non cambia cartella prima del comando: "aggiungi foto.jpg" o "-Archivio ./arch" valgono
# rispetto alla cartella in cui sei, come oblio.cmd su Windows.
QUI="$(cd "$(dirname "$0")" && pwd)" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "  Serve Node.js (versione 20 o successiva): https://nodejs.org"
  exit 1
fi
node "$QUI/bin/oblio.mjs" "$@"
codice=$?
if [ $# -eq 0 ] && [ -t 0 ]; then
  cd "$QUI" || exit 1
  echo ""
  echo "  Per usarlo da qui:  node bin/oblio.mjs <comando>   (la cartella è già quella giusta)"
  exec "${SHELL:-/bin/zsh}" -l
fi
exit $codice

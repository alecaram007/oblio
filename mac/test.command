#!/bin/bash
# Esegue tutti i test di Oblio (node --test).
cd "$(dirname "$0")" || exit 1
node --test
codice=$?
if [ -z "$OBLIO_VELOCE" ] && [ -t 0 ]; then
  read -r -p "  Premi Invio per chiudere." _
fi
exit $codice

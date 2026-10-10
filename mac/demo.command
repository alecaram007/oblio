#!/bin/bash
# La demo di Oblio: sette file di prova e più di un anno simulato, in demo/.
# Con --veloce (oppure OBLIO_VELOCE=1) non aspetta Invio alla fine.
cd "$(dirname "$0")" || exit 1
node bin/demo.mjs "$@"
codice=$?
case " $* " in *" --veloce "*) OBLIO_VELOCE=1 ;; esac
if [ -z "$OBLIO_VELOCE" ] && [ -t 0 ]; then
  read -r -p "  Premi Invio per chiudere." _
fi
exit $codice

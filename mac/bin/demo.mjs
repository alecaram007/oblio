#!/usr/bin/env node
// Demo di Oblio: crea sette file di prova, li affida all'oblio
// e simula più di un anno di vita dell'archivio, in "mac/demo".
//
// Uso:  node bin/demo.mjs [--veloce]
//   --veloce (oppure OBLIO_VELOCE=1) salta la pausa finale del lanciatore demo.command.

import { eseguiDemo } from '../lib/demo.mjs';
import { scrittore } from '../lib/cli.mjs';

try {
    eseguiDemo({ scrivi: scrittore(process.stdout) });
} catch (e) {
    scrittore(process.stderr)(`  Errore: ${e.message}`, 'Red');
    process.exitCode = 1;
}

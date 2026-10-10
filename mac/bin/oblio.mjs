#!/usr/bin/env node
// OBLIO - il file system che dimentica come un essere umano.
// Riga di comando per Mac: stessi comandi e opzioni della versione Windows.
//
// Uso:  oblio <comando> [argomento] [-Archivio <cartella>]      (oblio aiuto)

import { principale } from '../lib/cli.mjs';

process.exitCode = principale(process.argv.slice(2));

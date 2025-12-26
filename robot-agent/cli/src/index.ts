#!/usr/bin/env node
/**
 * @file index.ts
 * @description CLI entry point - routes to single command or REPL mode
 */

import { program } from './cli.js';
import { startRepl } from './repl.js';

// If no arguments (just 'roboctl'), start REPL mode
// Otherwise, parse command-line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === 'repl') {
  // Start interactive REPL mode
  startRepl();
} else {
  // Parse command and execute
  program.parse();
}

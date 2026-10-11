#!/usr/bin/env node
/**
 * tcg-worker: simulation worker for the owner's PC (BRIEF §4, PLAN §3.7). Usage:
 *   node dist/main.js            run until stopped (Ctrl+C); what the logon task starts
 *   node dist/main.js --once     play at most one chunk and exit
 *   node dist/main.js --check    show configuration, engine and server reachability, then exit
 */
import { run } from './run.js'

// The repository's worker is not a managed install: it never updates itself (D-026).
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)

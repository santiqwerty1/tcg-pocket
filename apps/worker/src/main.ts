#!/usr/bin/env node
/**
 * tcg-worker: simulation worker for the owner's PC (BRIEF §4, PLAN §3.7). Usage:
 *   node dist/main.js            run until stopped (Ctrl+C); what the logon task starts
 *   node dist/main.js --once     play at most one chunk and exit
 *   node dist/main.js --check    show configuration, engine and server reachability, then exit
 */
import { run } from './run.js'

run(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

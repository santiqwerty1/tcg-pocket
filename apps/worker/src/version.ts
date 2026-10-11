/**
 * The worker's version: the server gates new kinds of work by it (0.2.0 consistency, 0.2.1 meta, 0.2.2 coach, 0.2.3
 * undo). 0.2.4 (H-014): watchdog for a hung engine, single-attempt heartbeats, lets go of a chunk that is not its own.
 * 0.2.5 (H-010, T-017 A2): pairings with `perGame` report every game (winner, who started, ending, turns, stages).
 * 0.2.6: reports its engine's features in its claims and writes the app's hints about work it cannot play.
 * 0.2.7 (B2): with an engine that has `batch`, several pairings of one job in one engine process.
 * 0.2.8 (T-015, D-023): Android package and configurable background engine priority; interactive games stay normal.
 */
// 0.2.9 (T-015): shared graceful Android stop and Termux:Widget shortcuts.
// 0.2.10 (T-015): Android installer asks for and preserves the worker's display name.
// 0.2.11 (T-015, D-025): engine result failures, lease recovery, live reconnects and slow-bot opt-in.
// 0.3.0 (Fase 42, D-026): updates itself from the app's package (Windows portable and Android), with rollback.
// 0.3.1 (phase 42): each result says the engine that played it (version and build), for the API's exact cache.
export const WORKER_VERSION = '0.3.1'

/**
 * The worker's version: the server gates new kinds of work by it (0.2.0 consistency, 0.2.1 meta, 0.2.2 coach, 0.2.3
 * undo). 0.2.4 (H-014): watchdog for a hung engine, single-attempt heartbeats, lets go of a chunk that is not its own.
 * 0.2.5 (H-010, T-017 A2): pairings with `perGame` report every game (winner, who started, ending, turns, stages).
 * 0.2.6: reports its engine's features in its claims and writes the app's hints about work it cannot play.
 * 0.2.7 (B2): with an engine that has `batch`, several pairings of one job in one engine process.
 */
export const WORKER_VERSION = '0.2.7'

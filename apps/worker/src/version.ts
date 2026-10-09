/**
 * The worker's version: the server gates new kinds of work by it (0.2.0 consistency, 0.2.1 meta, 0.2.2 coach, 0.2.3
 * undo). 0.2.4 (H-014): watchdog for a hung engine, single-attempt heartbeats, lets go of a chunk that is not its own.
 */
export const WORKER_VERSION = '0.2.4'

import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { engineVersion, runJob } from './engine.js'
import type { EnginePriority } from './priority.js'
import { removeWorkDir } from './work-dir.js'

/**
 * The exit code of `--check-engine` when the engine is another one or plays differently (D-026): that package is
 * never used here. Any other failure (a timeout on a busy PC, a crash) is retried before giving up on it.
 */
export const DETERMINISM_MISMATCH = 3

/** The engine is not the reference's or does not reproduce its games: no amount of retrying changes it. */
export class DeterminismError extends Error {
  override name = 'DeterminismError'
}

export interface DeterminismReference {
  version: { engineRev: string; cliVersion: string }
  cases: { job: Record<string, unknown>; expected: Record<string, unknown> }[]
}

/**
 * Timing and replay paths depend on the machine, and so does `build` (the fingerprint has the compiler and the target,
 * engine-cli 0.3.4 on); every game and its seed must agree.
 */
export function deterministicResult(result: Record<string, unknown>): Record<string, unknown> {
  const { durationMs: _duration, replays: _replays, build: _build, ...stable } = result
  return stable
}

export async function checkDeterminism(
  engine: string,
  referenceFile: string,
  workDir: string,
  signal?: AbortSignal,
  options: { priority?: EnginePriority; caseTimeoutMs?: number } = {},
): Promise<void> {
  const reference = JSON.parse(await readFile(referenceFile, 'utf8')) as DeterminismReference
  const version = await engineVersion(engine, signal)
  if (version.engineRev !== reference.version.engineRev || version.cliVersion !== reference.version.cliVersion) {
    throw new DeterminismError(
      'El motor no corresponde a la referencia de determinismo. Volvé a instalar el paquete completo.',
    )
  }
  if (!reference.cases?.length) throw new Error('Falta la prueba de determinismo del paquete.')
  for (const test of reference.cases) {
    const { result, dir } = await runJob<Record<string, unknown>>(engine, 'simulate', test.job, workDir, {
      signal: AbortSignal.any([AbortSignal.timeout(options.caseTimeoutMs ?? 60_000), ...(signal ? [signal] : [])]),
      ...(options.priority ? { priority: options.priority } : {}),
    })
    try {
      if (!isDeepStrictEqual(deterministicResult(result), test.expected)) {
        throw new DeterminismError(
          'La misma semilla dio un resultado distinto al de la PC. No tomo trabajo para evitar mezclar simulaciones. Avisá al Coordinador y guardá la versión del paquete.',
        )
      }
    } finally {
      await removeWorkDir(dir)
    }
  }
}

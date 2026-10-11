import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { engineVersion, runJob } from './engine.js'
import { removeWorkDir } from './work-dir.js'

export interface DeterminismReference {
  version: { engineRev: string; cliVersion: string }
  cases: { job: Record<string, unknown>; expected: Record<string, unknown> }[]
}

/** Timing and replay paths depend on the machine; every game and its seed must agree. */
export function deterministicResult(result: Record<string, unknown>): Record<string, unknown> {
  const { durationMs: _duration, replays: _replays, ...stable } = result
  return stable
}

export async function checkDeterminism(
  engine: string,
  referenceFile: string,
  workDir: string,
  signal?: AbortSignal,
): Promise<void> {
  const reference = JSON.parse(await readFile(referenceFile, 'utf8')) as DeterminismReference
  const version = await engineVersion(engine, signal)
  if (version.engineRev !== reference.version.engineRev || version.cliVersion !== reference.version.cliVersion) {
    throw new Error('El motor no corresponde a la referencia de determinismo. Volvé a instalar el paquete completo.')
  }
  if (!reference.cases?.length) throw new Error('Falta la prueba de determinismo del paquete.')
  for (const test of reference.cases) {
    const { result, dir } = await runJob<Record<string, unknown>>(engine, 'simulate', test.job, workDir, {
      signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
    })
    try {
      if (!isDeepStrictEqual(deterministicResult(result), test.expected)) {
        throw new Error(
          'La misma semilla dio un resultado distinto al de la PC. No tomo trabajo para evitar mezclar simulaciones. Avisá al Coordinador y guardá la versión del paquete.',
        )
      }
    } finally {
      await removeWorkDir(dir)
    }
  }
}

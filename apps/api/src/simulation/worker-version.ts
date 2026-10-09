/**
 * Worker versions (H-002, Fase 36): «0.2.10» is newer than «0.2.2», which a text comparison gets wrong. The version
 * is free text from the worker, so anything that does not start with three numbers counts as 0.0.0 (it gets no
 * feature that needs a minimum version, and nothing breaks).
 */
const PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})/

function parts(version: string | null | undefined): [number, number, number] {
  const match = PATTERN.exec(version?.trim() ?? '')
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0]
}

export function versionAtLeast(version: string | null | undefined, minimum: string): boolean {
  const have = parts(version)
  const need = parts(minimum)
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) > (need[i] ?? 0)
  }
  return true
}

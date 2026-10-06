import { NotFoundException } from '@nestjs/common'

/**
 * Numeric database ids travel as strings in the API (docs/API.md: `id`, `variantOfId`, `adjustmentId`… are strings
 * so the PWA treats every identifier the same way). Path params are parsed back here: anything that is not a
 * positive integer is simply "not found".
 */
export function idToString(id: number): string {
  return String(id)
}

export function parseNumericId(raw: string | number | undefined, what = 'Recurso'): number {
  const text = typeof raw === 'number' ? String(raw) : (raw ?? '')
  if (!/^\d{1,15}$/.test(text)) throw new NotFoundException(`${what} ${text || '(vacío)'} no encontrado.`)
  return Number(text)
}

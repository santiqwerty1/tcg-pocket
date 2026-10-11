import { describe, expect, it } from 'vitest'
import { csvAgeDays, csvAgeNotice } from './csvAge'

const now = new Date('2026-10-20T12:00:00Z')

describe('csvAgeNotice', () => {
  it('stays quiet during the first week', () => {
    expect(csvAgeDays('2026-10-14T13:00:00Z', now)).toBe(5)
    expect(csvAgeNotice('2026-10-14T13:00:00Z', now)).toBeNull()
  })

  it('says how old the CSV is after a week', () => {
    expect(csvAgeNotice('2026-10-08T18:58:42Z', now)).toBe('Tu última sincronización es de hace 11 días')
  })

  it('asks for a first import', () => {
    expect(csvAgeNotice(null, now)).toBe('Todavía no sincronizaste tu colección')
  })
})

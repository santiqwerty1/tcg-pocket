import { describe, expect, it } from 'vitest'
import { detailRefetchMs } from './simulations'

const confirmation = (status: string) =>
  ({ jobId: status === 'pending' ? null : 2, status, error: null, rivals: 2, rows: [] }) as never

describe('detailRefetchMs', () => {
  it('reads a running job again every 10 s and a finished one never', () => {
    expect(detailRefetchMs({ status: 'running', optimizeConfirmation: null })).toBe(10_000)
    expect(detailRefetchMs({ status: 'done', optimizeConfirmation: null })).toBe(false)
    expect(detailRefetchMs(undefined)).toBe(false)
  })

  it('H-011.5: keeps reading a finished optimize while its confirmation waits or plays', () => {
    for (const status of ['pending', 'queued', 'running']) {
      expect(detailRefetchMs({ status: 'done', optimizeConfirmation: confirmation(status) })).toBe(10_000)
    }
    for (const status of ['done', 'failed', 'cancelled', 'skipped']) {
      expect(detailRefetchMs({ status: 'done', optimizeConfirmation: confirmation(status) })).toBe(false)
    }
  })
})

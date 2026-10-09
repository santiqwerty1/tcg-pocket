import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetSharedFile, forgetSharedText, sharedFile, sharedText } from './shared'

/** The bits of the Cache Storage that public/push-sw.js writes and the import screens read. */
function fakeCaches(entries: Record<string, Response>) {
  const store = new Map(Object.entries(entries))
  const cache = {
    match: async (key: string) => store.get(key)?.clone(),
    delete: async (key: string) => store.delete(key),
  }
  vi.stubGlobal('caches', { open: async () => cache })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shared files', () => {
  it('keeps the shared CSV, with its name, until the import that used it is done', async () => {
    const store = fakeCaches({
      '/compartido/archivo': new Response('Id,CardName\nA1-1,Bulbasaur\n', {
        headers: { 'content-type': 'text/csv', 'x-file-name': encodeURIComponent('export del tracker.csv') },
      }),
    })
    const file = await sharedFile()
    expect(file?.name).toBe('export del tracker.csv')
    expect(await file?.text()).toContain('Bulbasaur')
    // Still there: a failed upload (an expired session) must not lose it.
    expect(await sharedFile()).not.toBeNull()
    await forgetSharedFile()
    expect(store.has('/compartido/archivo')).toBe(false)
    expect(await sharedFile()).toBeNull()
  })

  it('keeps a shared deck text until it is forgotten', async () => {
    fakeCaches({ '/compartido/texto': new Response('Energy: Darkness\n2 Zorua B3 105') })
    expect(await sharedText()).toBe('Energy: Darkness\n2 Zorua B3 105')
    await forgetSharedText()
    expect(await sharedText()).toBeNull()
  })

  it('is empty where the browser has no Cache Storage', async () => {
    vi.stubGlobal('caches', undefined)
    expect(await sharedFile()).toBeNull()
  })
})

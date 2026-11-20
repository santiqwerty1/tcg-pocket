// The theme of this device has two implementations with the same rules: src/lib/look.ts (React) and public/look.js
// (before the first paint; the CSP forbids an inline script). Both run here against the same cases, so they cannot
// drift apart.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearClientCaches } from '@/api/session'
import { applyLook, LOOK_KEY, readLook, resolveTheme, THEME_COLOR, useLook, watchLook, writeLook } from './look'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const ROOT = process.cwd()
const PRE_PAINT = readFileSync(resolve(ROOT, 'public/look.js'), 'utf8')
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

/** A system colour scheme the tests can change (the shared setup's `matchMedia` always answers `false`). */
const system = { light: false, listeners: new Set<() => void>() }
vi.stubGlobal(
  'matchMedia',
  (query: string) =>
    ({
      get matches() {
        return query === '(prefers-color-scheme: light)' && system.light
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: () => void) => system.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => system.listeners.delete(listener),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
)

function systemTurns(scheme: 'light' | 'dark') {
  system.light = scheme === 'light'
  for (const listener of system.listeners) listener()
}

const theme = () => document.documentElement.getAttribute('data-theme')
const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
const stored = () => JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as unknown

beforeEach(() => {
  system.light = false
  // As index.html leaves the page before anything runs.
  document.documentElement.setAttribute('data-theme', 'dark')
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute('content', THEME_COLOR.dark)
  document.head.append(meta)
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
  document.documentElement.removeAttribute('data-theme')
})

afterAll(() => vi.unstubAllGlobals())

const CASES: { name: string; stored: string | null; system: 'light' | 'dark'; expected: 'light' | 'dark' }[] = [
  { name: 'nothing stored', stored: null, system: 'light', expected: 'dark' },
  { name: 'garbage', stored: '{"theme":', system: 'light', expected: 'dark' },
  { name: 'a string, not an object', stored: '"light"', system: 'light', expected: 'dark' },
  { name: 'null', stored: 'null', system: 'light', expected: 'dark' },
  { name: 'an array', stored: '["light"]', system: 'light', expected: 'dark' },
  { name: 'a theme that does not exist', stored: '{"theme":"sepia"}', system: 'light', expected: 'dark' },
  { name: 'light', stored: '{"theme":"light"}', system: 'dark', expected: 'light' },
  { name: 'dark on a light system', stored: '{"theme":"dark"}', system: 'light', expected: 'dark' },
  { name: 'system on a light system', stored: '{"theme":"system"}', system: 'light', expected: 'light' },
  { name: 'system on a dark system', stored: '{"theme":"system"}', system: 'dark', expected: 'dark' },
  {
    name: 'light next to keys of a later version',
    stored: '{"motion":"none","theme":"light"}',
    system: 'dark',
    expected: 'light',
  },
]

const IMPLEMENTATIONS: { name: string; run: () => void }[] = [
  {
    name: 'src/lib/look.ts',
    run: () => {
      applyLook()
    },
  },
  // A classic script: evaluated as the browser does, against this document and this storage.
  { name: 'public/look.js', run: () => new Function(PRE_PAINT)() },
]

describe.each(IMPLEMENTATIONS)('the theme of this device, by $name', ({ run }) => {
  it.each(CASES)('$name → $expected', ({ stored: value, system: scheme, expected }) => {
    if (value !== null) localStorage.setItem(LOOK_KEY, value)
    system.light = scheme === 'light'
    // Start from the other theme, so a run that does nothing cannot pass.
    const other = expected === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', other)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[other])

    run()

    expect(theme()).toBe(expected)
    expect(themeColor()).toBe(THEME_COLOR[expected])
  })

  it('is dark, and does not throw, when the storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    document.documentElement.setAttribute('data-theme', 'light')
    expect(run).not.toThrow()
    expect(theme()).toBe('dark')
    expect(themeColor()).toBe(THEME_COLOR.dark)
  })

  it('does not need the theme-color meta to be there', () => {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
    localStorage.setItem(LOOK_KEY, '{"theme":"light"}')
    expect(run).not.toThrow()
    expect(theme()).toBe('light')
  })
})

describe('public/look.js and index.html', () => {
  it('is a small script without dependencies', () => {
    expect(PRE_PAINT.split('\n').length).toBeLessThan(40)
    expect(PRE_PAINT).not.toMatch(/\b(import|require)\b/)
  })

  it('the page starts dark, with one theme-color, and loads the script from <head> after the meta it sets', () => {
    const page = new DOMParser().parseFromString(INDEX_HTML, 'text/html')
    expect(page.documentElement.getAttribute('data-theme')).toBe('dark')
    const metas = page.querySelectorAll('meta[name="theme-color"]')
    expect(metas).toHaveLength(1)
    expect(metas[0]?.getAttribute('content')).toBe(THEME_COLOR.dark)
    expect(metas[0]?.hasAttribute('media')).toBe(false)
    expect(page.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark light')
    const script = page.head.querySelector('script[src="/look.js"]')
    expect(script).not.toBeNull()
    // Not a module and not deferred: it has to run before the body is painted.
    expect(script?.hasAttribute('type')).toBe(false)
    expect(script?.hasAttribute('defer')).toBe(false)
    expect(script?.hasAttribute('async')).toBe(false)
    expect(metas[0]?.compareDocumentPosition(script as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // No inline script: the CSP would refuse it.
    for (const other of page.querySelectorAll('script')) expect(other.getAttribute('src')).toBeTruthy()
  })
})

describe('look.ts', () => {
  it('is dark when nothing is stored, and «system» is light only on a light system', () => {
    expect(readLook()).toEqual({ theme: 'dark' })
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('system')).toBe('dark')
    system.light = true
    expect(resolveTheme('system')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('writing «light» reaches the page at once and survives a new read', () => {
    writeLook({ theme: 'light' })
    expect(theme()).toBe('light')
    expect(themeColor()).toBe(THEME_COLOR.light)
    expect(stored()).toEqual({ theme: 'light' })
    expect(readLook()).toEqual({ theme: 'light' })
    // A reload: the page is back as index.html leaves it, and the stored choice puts it right again.
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(applyLook()).toBe('light')
    expect(theme()).toBe('light')
  })

  it('writing «system» stores the choice, never the resolved theme', () => {
    system.light = true
    writeLook({ theme: 'system' })
    expect(stored()).toEqual({ theme: 'system' })
    expect(readLook()).toEqual({ theme: 'system' })
    expect(theme()).toBe('light')
    expect(themeColor()).toBe(THEME_COLOR.light)
  })

  it('keeps the keys it does not know when it writes', () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: 'light', motion: 'none', views: { where: 'top' } }))
    writeLook({ theme: 'dark' })
    expect(stored()).toEqual({ theme: 'dark', motion: 'none', views: { where: 'top' } })
    expect(theme()).toBe('dark')
  })

  it('writes over garbage', () => {
    localStorage.setItem(LOOK_KEY, '{"theme":')
    writeLook({ theme: 'light' })
    expect(stored()).toEqual({ theme: 'light' })
  })

  it('follows the system while the app is open, only with «system»', () => {
    watchLook()
    writeLook({ theme: 'system' })
    expect(theme()).toBe('dark')
    systemTurns('light')
    expect(theme()).toBe('light')
    expect(themeColor()).toBe(THEME_COLOR.light)
    systemTurns('dark')
    expect(theme()).toBe('dark')

    writeLook({ theme: 'dark' })
    systemTurns('light')
    expect(theme()).toBe('dark')
    expect(stored()).toEqual({ theme: 'dark' })
  })

  it('takes the change another tab made', () => {
    watchLook()
    localStorage.setItem(LOOK_KEY, '{"theme":"light"}')
    expect(theme()).toBe('dark')
    window.dispatchEvent(new StorageEvent('storage', { key: LOOK_KEY }))
    expect(theme()).toBe('light')
    // Some other key of the app: nothing to do.
    localStorage.setItem(LOOK_KEY, '{"theme":"dark"}')
    window.dispatchEvent(new StorageEvent('storage', { key: 'tcg.ui' }))
    expect(theme()).toBe('light')
  })

  it('a choice the storage refuses still holds on this page: the attribute and the choice never disagree', () => {
    const { result } = renderHook(() => useLook())
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    act(() => result.current.setTheme('light'))
    expect(theme()).toBe('light')
    expect(result.current).toMatchObject({ theme: 'light', resolved: 'light' })
    expect(stored()).toBeNull()
    // Once the storage takes it again, the next choice is saved.
    refuse.mockRestore()
    act(() => result.current.setTheme('dark'))
    expect(stored()).toEqual({ theme: 'dark' })
    expect(theme()).toBe('dark')
  })
})

describe('the look and the session', () => {
  it.each(['logout', 'expired'] as const)(
    'stays on this device after a %s: it is not personal data',
    async (reason) => {
      writeLook({ theme: 'light' })
      localStorage.setItem('tcg.match-suggestions', '[]')
      await clearClientCaches(reason)
      // What the clean-up does remove is gone, so this is not a clean-up that did nothing.
      expect(localStorage.getItem('tcg.match-suggestions')).toBeNull()
      expect(stored()).toEqual({ theme: 'light' })
      expect(applyLook()).toBe('light')
    },
  )
})

describe('useLook', () => {
  it('gives the choice, the resolved theme and a setter that applies at once', () => {
    const { result } = renderHook(() => useLook())
    expect(result.current).toMatchObject({ theme: 'dark', resolved: 'dark' })

    act(() => result.current.setTheme('light'))
    expect(result.current).toMatchObject({ theme: 'light', resolved: 'light' })
    expect(theme()).toBe('light')
    expect(stored()).toEqual({ theme: 'light' })

    act(() => result.current.setTheme('system'))
    expect(result.current).toMatchObject({ theme: 'system', resolved: 'dark' })
    expect(theme()).toBe('dark')

    // The system changes under «system»: the choice stays, what it resolves to follows.
    act(() => systemTurns('light'))
    expect(result.current).toMatchObject({ theme: 'system', resolved: 'light' })
    expect(theme()).toBe('light')
  })

  it('a change made elsewhere (another component) reaches every user of the hook', () => {
    const first = renderHook(() => useLook())
    const second = renderHook(() => useLook())
    act(() => first.result.current.setTheme('light'))
    expect(second.result.current.theme).toBe('light')
  })
})

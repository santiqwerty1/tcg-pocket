// The look of this device (the theme, the motion level, where the views go) has two implementations with the same
// rules: src/lib/look.ts (React) and public/look.js (before the first paint; the CSP forbids an inline script). Both
// run here against the same cases, so they cannot drift apart.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearClientCaches } from '@/api/session'
import {
  applyLook,
  LOOK_KEY,
  readLook,
  reducedBySystem,
  resolveMotion,
  resolveTheme,
  scrollBehavior,
  THEME_COLOR,
  useLook,
  watchLook,
  writeLook,
} from './look'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const ROOT = process.cwd()
const PRE_PAINT = readFileSync(resolve(ROOT, 'public/look.js'), 'utf8')
const INDEX_HTML = readFileSync(resolve(ROOT, 'index.html'), 'utf8')

const LIGHT_QUERY = '(prefers-color-scheme: light)'
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

/** A system the tests can change: its colour scheme and whether it asks to reduce motion (the shared setup's
 * `matchMedia` always answers `false`). The listeners are kept per media query, as a browser keeps them: a change is
 * told only to who watches the query that changed, so the tests see which queries `watchLook()` follows. */
const system = { light: false, reduced: false, listeners: new Map<string, Set<() => void>>() }
vi.stubGlobal(
  'matchMedia',
  (query: string) =>
    ({
      get matches() {
        return (query === LIGHT_QUERY && system.light) || (query === REDUCED_QUERY && system.reduced)
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: () => void) => {
        if (!system.listeners.has(query)) system.listeners.set(query, new Set())
        system.listeners.get(query)?.add(listener)
      },
      removeEventListener: (_type: string, listener: () => void) => system.listeners.get(query)?.delete(listener),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
)

function systemTurns(scheme: 'light' | 'dark') {
  system.light = scheme === 'light'
  for (const listener of system.listeners.get(LIGHT_QUERY) ?? []) listener()
}

function systemReducesMotion(reduced: boolean) {
  system.reduced = reduced
  for (const listener of system.listeners.get(REDUCED_QUERY) ?? []) listener()
}

const theme = () => document.documentElement.getAttribute('data-theme')
const motion = () => document.documentElement.getAttribute('data-motion')
const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
const stored = () => JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as unknown

beforeEach(() => {
  system.light = false
  system.reduced = false
  // As index.html leaves the page before anything runs.
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.setAttribute('data-motion', 'full')
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute('content', THEME_COLOR.dark)
  document.head.append(meta)
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-motion')
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
    stored: '{"density":"compact","theme":"light"}',
    system: 'dark',
    expected: 'light',
  },
]

type Level = 'full' | 'subtle' | 'none'
const MOTION_CASES: { name: string; stored: string | null; reduced: boolean; expected: Level }[] = [
  { name: 'nothing stored', stored: null, reduced: false, expected: 'full' },
  { name: 'garbage', stored: '{"motion":', reduced: false, expected: 'full' },
  { name: 'a string, not an object', stored: '"none"', reduced: false, expected: 'full' },
  { name: 'null', stored: 'null', reduced: false, expected: 'full' },
  { name: 'a level that does not exist', stored: '{"motion":"wild"}', reduced: false, expected: 'full' },
  { name: 'full', stored: '{"motion":"full"}', reduced: false, expected: 'full' },
  { name: 'subtle', stored: '{"motion":"subtle"}', reduced: false, expected: 'subtle' },
  { name: 'none', stored: '{"motion":"none"}', reduced: false, expected: 'none' },
  { name: 'nothing stored, on a system that reduces motion', stored: null, reduced: true, expected: 'none' },
  { name: 'full on a system that reduces motion', stored: '{"motion":"full"}', reduced: true, expected: 'none' },
  { name: 'subtle on a system that reduces motion', stored: '{"motion":"subtle"}', reduced: true, expected: 'none' },
  {
    name: 'subtle next to a theme and keys of a later version',
    stored: '{"density":"compact","theme":"light","motion":"subtle","views":"top"}',
    reduced: false,
    expected: 'subtle',
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

  it.each(MOTION_CASES)('motion: $name → $expected', ({ stored: value, reduced, expected }) => {
    if (value !== null) localStorage.setItem(LOOK_KEY, value)
    system.reduced = reduced
    // Start from another level, so a run that does nothing cannot pass.
    document.documentElement.setAttribute('data-motion', expected === 'subtle' ? 'none' : 'subtle')

    run()

    expect(motion()).toBe(expected)
  })

  it('is dark and moves in full, and does not throw, when the storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    document.documentElement.setAttribute('data-theme', 'light')
    document.documentElement.setAttribute('data-motion', 'none')
    expect(run).not.toThrow()
    expect(theme()).toBe('dark')
    expect(themeColor()).toBe(THEME_COLOR.dark)
    expect(motion()).toBe('full')
  })

  it('a blocked storage still obeys a system that reduces motion', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    system.reduced = true
    expect(run).not.toThrow()
    expect(motion()).toBe('none')
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
    // The motion level too: the stylesheet's «full» values are the ones of a page no script has touched.
    expect(page.documentElement.getAttribute('data-motion')).toBe('full')
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
    expect(readLook()).toEqual({ theme: 'dark', motion: 'full', views: 'bottom' })
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
    expect(readLook()).toEqual({ theme: 'light', motion: 'full', views: 'bottom' })
    // A reload: the page is back as index.html leaves it, and the stored choice puts it right again.
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(applyLook()).toBe('light')
    expect(theme()).toBe('light')
  })

  it('writing «system» stores the choice, never the resolved theme', () => {
    system.light = true
    writeLook({ theme: 'system' })
    expect(stored()).toEqual({ theme: 'system' })
    expect(readLook()).toEqual({ theme: 'system', motion: 'full', views: 'bottom' })
    expect(theme()).toBe('light')
    expect(themeColor()).toBe(THEME_COLOR.light)
  })

  it('keeps the keys it does not know when it writes', () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: 'light', density: 'compact', x: { y: 1 } }))
    writeLook({ theme: 'dark' })
    expect(stored()).toEqual({ theme: 'dark', density: 'compact', x: { y: 1 } })
    expect(theme()).toBe('dark')
    // Each choice is written on its own: the others, known or not, stay as they were.
    writeLook({ motion: 'subtle' })
    writeLook({ views: 'top' })
    expect(stored()).toEqual({ theme: 'dark', density: 'compact', x: { y: 1 }, motion: 'subtle', views: 'top' })
    expect(readLook()).toEqual({ theme: 'dark', motion: 'subtle', views: 'top' })
  })

  it('moves in full with the views below when nothing valid is stored', () => {
    for (const value of ['{"motion":"wild","views":"left"}', '{"motion":1,"views":null}', '{"motion":["none"]}']) {
      localStorage.setItem(LOOK_KEY, value)
      expect(readLook(), value).toEqual({ theme: 'dark', motion: 'full', views: 'bottom' })
    }
    localStorage.setItem(LOOK_KEY, '{"motion":"none","views":"top"}')
    expect(readLook()).toEqual({ theme: 'dark', motion: 'none', views: 'top' })
  })

  it('writing a motion level reaches the page at once and survives a new read', () => {
    writeLook({ motion: 'subtle' })
    expect(motion()).toBe('subtle')
    expect(stored()).toEqual({ motion: 'subtle' })
    // A reload: the page is back as index.html leaves it, and the stored choice puts it right again.
    document.documentElement.setAttribute('data-motion', 'full')
    applyLook()
    expect(motion()).toBe('subtle')
    writeLook({ motion: 'none' })
    expect(motion()).toBe('none')
    writeLook({ motion: 'full' })
    expect(motion()).toBe('full')
  })

  it('the place of the views is stored, and is no attribute of the page', () => {
    const before = [...document.documentElement.attributes].map((attribute) => attribute.name).sort()
    writeLook({ views: 'top' })
    expect(stored()).toEqual({ views: 'top' })
    expect(readLook().views).toBe('top')
    expect([...document.documentElement.attributes].map((attribute) => attribute.name).sort()).toEqual(before)
  })

  it('a system that asks to reduce motion wins over the choice, which is not overwritten', () => {
    writeLook({ motion: 'full' })
    expect(resolveMotion('full')).toBe('full')
    expect(reducedBySystem()).toBe(false)
    system.reduced = true
    expect(reducedBySystem()).toBe(true)
    for (const level of ['full', 'subtle', 'none'] as const) expect(resolveMotion(level)).toBe('none')
    applyLook()
    expect(motion()).toBe('none')
    expect(stored()).toEqual({ motion: 'full' })
    system.reduced = false
    applyLook()
    expect(motion()).toBe('full')
  })

  it('a scroll asked by code is smooth, except with «none» (chosen or asked by the system)', () => {
    expect(scrollBehavior()).toBe('smooth')
    writeLook({ motion: 'subtle' })
    expect(scrollBehavior()).toBe('smooth')
    writeLook({ motion: 'none' })
    expect(scrollBehavior()).toBe('auto')
    writeLook({ motion: 'full' })
    system.reduced = true
    expect(scrollBehavior()).toBe('auto')
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

  it('follows the system’s reduced-motion setting while the app is open', () => {
    watchLook()
    // Each of the two queries has its own listener: a change of one is not told to who watches the other.
    expect([...system.listeners.keys()].sort()).toEqual([LIGHT_QUERY, REDUCED_QUERY].sort())
    for (const watchers of system.listeners.values()) expect(watchers.size).toBe(1)
    writeLook({ motion: 'subtle' })
    expect(motion()).toBe('subtle')
    systemReducesMotion(true)
    expect(motion()).toBe('none')
    systemReducesMotion(false)
    expect(motion()).toBe('subtle')
    expect(stored()).toEqual({ motion: 'subtle' })
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

  it('the motion and the views the storage refuses hold on this page too, next to each other', () => {
    const { result } = renderHook(() => useLook())
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    act(() => result.current.setMotion('none'))
    act(() => result.current.setViews('top'))
    expect(motion()).toBe('none')
    expect(result.current).toMatchObject({ motion: 'none', resolvedMotion: 'none', views: 'top' })
    expect(scrollBehavior()).toBe('auto')
    expect(stored()).toBeNull()
    // Once the storage takes it again, the next choice is saved with what was held.
    refuse.mockRestore()
    act(() => result.current.setMotion('subtle'))
    expect(stored()).toEqual({ motion: 'subtle', views: 'top' })
    expect(motion()).toBe('subtle')
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
    act(() => first.result.current.setViews('top'))
    expect(second.result.current.views).toBe('top')
  })

  it('gives the motion level, what it resolves to and the place of the views, with their setters', () => {
    const { result } = renderHook(() => useLook())
    expect(result.current).toMatchObject({
      motion: 'full',
      resolvedMotion: 'full',
      reducedBySystem: false,
      views: 'bottom',
    })

    act(() => result.current.setMotion('subtle'))
    expect(result.current).toMatchObject({ motion: 'subtle', resolvedMotion: 'subtle' })
    expect(motion()).toBe('subtle')
    expect(stored()).toEqual({ motion: 'subtle' })

    act(() => result.current.setViews('top'))
    expect(result.current.views).toBe('top')
    expect(stored()).toEqual({ motion: 'subtle', views: 'top' })

    // The system asks to reduce motion: the choice stays, what it resolves to is «none».
    act(() => systemReducesMotion(true))
    expect(result.current).toMatchObject({ motion: 'subtle', resolvedMotion: 'none', reducedBySystem: true })
    expect(motion()).toBe('none')
    act(() => systemReducesMotion(false))
    expect(result.current).toMatchObject({ motion: 'subtle', resolvedMotion: 'subtle', reducedBySystem: false })
    // The theme's fields are as they were.
    expect(result.current).toMatchObject({ theme: 'dark', resolved: 'dark' })
  })
})

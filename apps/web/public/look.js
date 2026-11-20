/*
 * The theme, before the first paint: the app's CSP allows no inline script, so this small file is loaded from <head>.
 * Same rules as src/lib/look.ts (src/lib/look.test.ts runs the two against the same cases): the choice of this device
 * is localStorage['tcg.look'] = { "theme": "dark" | "light" | "system" }; dark when there is nothing valid; «system»
 * is light only if the system asks for light. It must never throw: the storage can be blocked.
 */
;(() => {
  let theme = 'dark'
  try {
    const saved = JSON.parse(localStorage.getItem('tcg.look') || '{}')
    if (saved && (saved.theme === 'light' || saved.theme === 'system')) theme = saved.theme
  } catch {}
  let light = theme === 'light'
  try {
    if (theme === 'system') light = !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {}
  try {
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', light ? '#f1eee8' : '#0a0e14')
  } catch {}
})()

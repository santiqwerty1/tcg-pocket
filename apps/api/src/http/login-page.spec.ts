import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderLoginPage } from './login-page.js'

// The page copies four things of the app, which it cannot load without the session: the rules of the theme
// (public/look.js), the tokens of both themes, the fallback faces and the column (src/index.css). They are read here
// from the repository (from this file, wherever the tests run), so a copy that drifts from its source fails.
const web = (file: string) => readFileSync(fileURLToPath(new URL(`../../../web/${file}`, import.meta.url)), 'utf8')
const LOOK_JS = web('public/look.js')
const INDEX_CSS = web('src/index.css')

const NONCE = 'abc123'
const html = renderLoginPage({ nonce: NONCE })
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((found) => ({
  at: found.index,
  attributes: found[1] ?? '',
  code: found[2] ?? '',
}))
const THEME_SCRIPT = scripts[0]?.code ?? ''
const STYLE = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''

const THEMES = ['dark', 'light'] as const
type Theme = (typeof THEMES)[number]
/** Where each theme's tokens live, in index.css and in the page. */
const BLOCK: Record<Theme, string> = { dark: ':root', light: ':root[data-theme="light"]' }

interface Rule {
  prelude: string
  declarations: Map<string, string>
  rules: Rule[]
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The index of the `}` that closes the `{` at `open`; quoted text is skipped. */
function closing(text: string, open: number): number {
  let depth = 0
  let at = open
  while (at < text.length) {
    const char = text[at]
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, at + 1)
      if (end === -1) break
      at = end
    } else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return at
    }
    at += 1
  }
  throw new Error('unbalanced CSS')
}

/** Enough of a CSS parser for index.css and for the page: nested blocks, declarations, comments, quoted text. An
 * at-rule without a block (`@import`, `@apply`) is skipped. */
function parseBlock(prelude: string, text: string): Rule {
  const rule: Rule = { prelude, declarations: new Map(), rules: [] }
  const declare = (statement: string) => {
    const colon = statement.indexOf(':')
    if (colon === -1 || statement.trimStart().startsWith('@')) return
    rule.declarations.set(squash(statement.slice(0, colon)), squash(statement.slice(colon + 1)))
  }
  let start = 0
  let at = 0
  while (at < text.length) {
    const char = text[at]
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, at + 1)
      if (end === -1) throw new Error('unclosed string in CSS')
      at = end + 1
    } else if (char === ';') {
      declare(text.slice(start, at))
      at += 1
      start = at
    } else if (char === '{') {
      const end = closing(text, at)
      rule.rules.push(parseBlock(squash(text.slice(start, at)), text.slice(at + 1, end)))
      at = end + 1
      start = at
    } else at += 1
  }
  declare(text.slice(start))
  return rule
}

const parseCss = (source: string) => parseBlock('', source.replace(/\/\*[\s\S]*?\*\//g, ''))

const PAGE = parseCss(STYLE)
const APP = parseCss(INDEX_CSS)

/** The one rule with exactly that prelude: a second `:root` would hide values from these tests. */
function only(css: Rule, prelude: string): Rule {
  const found = css.rules.filter((rule) => rule.prelude === prelude)
  if (found.length !== 1 || !found[0]) throw new Error(`expected one «${prelude}», found ${found.length}`)
  return found[0]
}

const customProperties = (rule: Rule) => new Map([...rule.declarations].filter(([name]) => name.startsWith('--')))

const nested = (rule: Rule): Rule[] => [rule, ...rule.rules.flatMap(nested)]
/** Every rule of the page but the two token blocks, the nested ones included. */
const OUTSIDE_THE_TOKENS = PAGE.rules.filter((rule) => !Object.values(BLOCK).includes(rule.prelude)).flatMap(nested)

/** The selectors of the page that declare a property, in order; one inside an at-rule comes after it and a «/». */
function declaring(property: string): string[] {
  const within = (rule: Rule, around: string): string[] => [
    ...(rule.declarations.has(property) ? [`${around}${rule.prelude}`] : []),
    ...rule.rules.flatMap((inner) => within(inner, `${around}${rule.prelude} / `)),
  ]
  return PAGE.rules.filter((rule) => !Object.values(BLOCK).includes(rule.prelude)).flatMap((rule) => within(rule, ''))
}

/** What the page declares for a selector, alone or in a list of selectors; the last rule wins, as in the cascade. */
function declared(selector: string, property: string, scope: Rule = PAGE): string {
  const value = lookUp(selector, property, scope)
  if (value === undefined) throw new Error(`the page declares no ${property} for «${selector}»`)
  return value
}

function lookUp(selector: string, property: string, scope: Rule = PAGE): string | undefined {
  return scope.rules
    .filter((rule) => rule.prelude.split(',').map(squash).includes(selector) && rule.declarations.has(property))
    .at(-1)
    ?.declarations.get(property)
}

/** A length written in rem, in px at the 16 px a browser starts from: a rem follows the font size chosen there. */
function px(length: string, where: string): number {
  expect(length, where).toMatch(/^\d+(?:\.\d+)?rem$/)
  return Number.parseFloat(length) * 16
}

/** The colours CSS knows by name, `transparent`, and the ones it takes from the system (the retired ones too). */
const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat
  white whitesmoke yellow yellowgreen
  accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext
  highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext
  activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder
  inactivecaption inactivecaptiontext infobackground infotext menu menutext scrollbar threeddarkshadow threedface
  threedhighlight threedlightshadow threedshadow window windowframe windowtext`.split(/\s+/),
)

type Rgb = [number, number, number]
interface Paint {
  rgb: Rgb
  alpha: number
}

function parseColor(value: string): Paint {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (hex) return { rgb: [hex[1], hex[2], hex[3]].map((pair) => Number.parseInt(pair ?? '', 16)) as Rgb, alpha: 1 }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value)
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4] ?? 1) }
  throw new Error(`not a colour these tests can read: ${value}`)
}

const tokensOf = (theme: Theme): Map<string, string> =>
  new Map([
    ...customProperties(only(PAGE, BLOCK.dark)),
    ...(theme === 'light' ? customProperties(only(PAGE, BLOCK.light)) : []),
  ])

/** What a declared colour is in a theme: a token, the literal a token holds, or two of them mixed in sRGB. */
function paint(value: string, theme: Theme): Paint {
  const token = /^var\((--[\w-]+)\)$/.exec(value)
  if (token) {
    const held = tokensOf(theme).get(token[1] ?? '')
    if (held === undefined) throw new Error(`the page has no ${token[1]} in the ${theme} theme`)
    return paint(held, theme)
  }
  const mix = /^color-mix\(in srgb, (\S+) ([\d.]+)%, (\S+)\)$/.exec(value)
  if (mix) {
    const [first, second] = [paint(mix[1] ?? '', theme), paint(mix[3] ?? '', theme)]
    if (first.alpha !== 1 || second.alpha !== 1) throw new Error(`a mix of translucent colours: ${value}`)
    const share = Number(mix[2]) / 100
    return { rgb: first.rgb.map((part, at) => part * share + (second.rgb[at] ?? 0) * (1 - share)) as Rgb, alpha: 1 }
  }
  return parseColor(value)
}

/** The colour seen where those backgrounds are stacked, the first one at the back. */
function stack(theme: Theme, ...backgrounds: string[]): Rgb {
  let seen: Rgb | null = null
  for (const background of backgrounds) {
    const top = paint(background, theme)
    const behind: Rgb | null = seen
    if (!behind && top.alpha !== 1) throw new Error(`nothing behind a translucent ${background}`)
    seen = behind ? (top.rgb.map((part, at) => part * top.alpha + (behind[at] ?? 0) * (1 - top.alpha)) as Rgb) : top.rgb
  }
  if (!seen) throw new Error('no background')
  return seen
}

/** The colour of a text or of a line: the first of those selectors that declares it (the rest is inherited). */
function ink(theme: Theme, property: string, ...selectors: string[]): Rgb {
  for (const selector of selectors) {
    const value = lookUp(selector, property)
    if (value === undefined) continue
    const token = /var\(--[\w-]+\)/.exec(value)?.[0]
    if (!token) throw new Error(`«${selector}» takes its ${property} from no token: ${value}`)
    const colour = paint(token, theme)
    if (colour.alpha !== 1) throw new Error(`a translucent ${property} for «${selector}»`)
    return colour.rgb
  }
  throw new Error(`no ${property} for ${selectors.join(', ')}`)
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((part) => {
    const share = part / 255
    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(one: Rgb, other: Rgb): number {
  const [dim, bright] = [luminance(one), luminance(other)].sort((a, b) => a - b) as [number, number]
  return (bright + 0.05) / (dim + 0.05)
}

describe('renderLoginPage', () => {
  it('is a Spanish page with the three fields, its texts, and the nonce on its two scripts', () => {
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('id="email"')
    expect(html).toContain('id="password"')
    expect(html).toContain('id="totp"')
    // apps/web/e2e/auth.setup.ts logs in through these labels and this button.
    expect(html).toContain('<label for="email">Correo</label>')
    expect(html).toContain('<label for="password">Contraseña</label>')
    expect(html).toContain('<label for="totp">Código de 6 dígitos</label>')
    expect(html).toContain('<button id="submit" type="submit">Entrar</button>')
    expect(html).toContain('<p id="error" class="error" role="alert"></p>')
    for (const autocomplete of ['username', 'current-password', 'one-time-code']) {
      expect(html).toContain(`autocomplete="${autocomplete}"`)
    }
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">')
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">')
    // Inline, and each with the nonce of the response: no `src`, nothing else for the CSP to let through.
    expect(html.match(/<script/g)).toHaveLength(2)
    expect(scripts.map((script) => script.attributes)).toEqual([` nonce="${NONCE}"`, ` nonce="${NONCE}"`])
  })

  it('refuses a nonce that is not a base64 value: it is written into the page as it comes', () => {
    for (const nonce of ['', 'a b', 'abc"', '"><script>alert(1)</script><x y="', "x' 'unsafe-inline", 'a=b']) {
      expect(() => renderLoginPage({ nonce }), nonce).toThrow('nonce')
    }
    // What the controller makes, and the other alphabet a CSP accepts.
    for (const encoding of ['base64url', 'base64'] as const) {
      const nonce = randomBytes(16).toString(encoding)
      expect(renderLoginPage({ nonce }).split(`<script nonce="${nonce}">`), encoding).toHaveLength(3)
    }
  })

  it('never sends what is typed in the address: without its script the form posts', () => {
    // A form without a method is sent with GET: where the script did not run (JavaScript off, an extension that
    // refuses it), the mail, the password and the code would end in the address, the history and the server's log.
    expect(html).toContain('<form id="login" method="post" novalidate>')
    expect(html.match(/<form\b/g)).toHaveLength(1)
  })

  it('loads no external assets and posts JSON to /api/auth/login', () => {
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/)
    expect(html).not.toContain('@import')
    expect(html).toContain("fetch('/api/auth/login'")
    expect(html).toContain("window.location.replace('/')")
  })

  it('reads the error envelope ({ error: { code, message } }) to show the TOTP prompt and server messages', () => {
    expect(html).toContain('data.error')
    expect(html).toContain("err.code === 'totp_required'")
    expect(html).toContain('err.message')
    expect(html).not.toMatch(/data\.code|data\.message/)
  })

  it('starts dark, and resolves the theme in <head>: the two metas, then the script, then the styles', () => {
    const background = tokensOf('dark').get('--background')
    const scheme = '<meta name="color-scheme" content="dark">'
    const color = `<meta name="theme-color" content="${background}">`
    expect(html.match(/<meta name="color-scheme"/g)).toHaveLength(1)
    expect(html.match(/<meta name="theme-color"/g)).toHaveLength(1)
    expect(html).toContain(scheme)
    expect(html).toContain(color)
    // Without JavaScript nothing sets the attribute, and `:root` alone is the dark theme.
    expect(html).not.toMatch(/<html[^>]*data-theme/)

    const [theme, form] = scripts
    if (!theme || !form) throw new Error('the page has no two scripts')
    expect(theme.code).toContain("localStorage.getItem('tcg.look')")
    expect(Math.max(html.indexOf(scheme), html.indexOf(color))).toBeLessThan(theme.at)
    // Before the styles, so the first paint already has the theme; the form's script stays at the end of the body.
    expect(theme.at).toBeLessThan(html.indexOf('<style>'))
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('</head>'))
    expect(form.code).toContain("fetch('/api/auth/login'")
    expect(form.at).toBeGreaterThan(html.indexOf('</main>'))
  })
})

/** A browser as the two scripts see it. */
interface World {
  /** localStorage['tcg.look']. */
  stored: string | null
  system: Theme
  storage?: 'throws' | 'missing'
  media?: 'throws' | 'missing'
  without?: 'color-scheme' | 'theme-color'
  /** document.querySelector throws: the theme is already set when the metas are looked for. */
  selectors?: 'throw'
}

interface Outcome {
  threw: boolean
  theme: string | null
  scheme: string | null
  color: string | null
}

type Call = [on: string, attribute: string, value: string]

/** What the metas hold before a script runs: the other theme, so a script that does nothing cannot pass. */
function untouched(expected: Theme) {
  const other: Theme = expected === 'light' ? 'dark' : 'light'
  return { scheme: other, color: `the ${other} colour` }
}

/**
 * Runs a classic script in a browser that has what look.js touches and nothing else. Both scripts swallow what
 * throws, so a script that reaches for anything more (document.write, innerHTML, className, location…) would go
 * unseen: every name and member this browser does not have is kept in `strays`, and every setAttribute in `calls`.
 */
function inFakeBrowser(code: string, world: World, expected: Theme) {
  const calls: Call[] = []
  const strays: string[] = []
  let writes = 0
  let listeners = 0
  const strict = <T extends object>(name: string, members: T): T =>
    new Proxy(members, {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || Object.hasOwn(target, key)) return Reflect.get(target, key, receiver)
        strays.push(`${name}.${key}`)
        throw new TypeError(`this browser has no ${name}.${key}`)
      },
      set(_target, key) {
        strays.push(`${name}.${String(key)} = …`)
        return false
      },
      defineProperty(_target, key) {
        strays.push(`${name}.${String(key)} = …`)
        return false
      },
      deleteProperty(_target, key) {
        strays.push(`delete ${name}.${String(key)}`)
        return false
      },
    })
  const element = (name: string, attributes: Map<string, string>) =>
    strict(name, {
      setAttribute: (attribute: string, value: string) => {
        calls.push([name, attribute, value])
        attributes.set(attribute, value)
      },
    })
  const html = new Map<string, string>()
  const scheme = new Map([['content', untouched(expected).scheme]])
  const color = new Map([['content', untouched(expected).color]])
  const metas: Record<string, object | null> = {
    'meta[name="color-scheme"]': world.without === 'color-scheme' ? null : element('color-scheme', scheme),
    'meta[name="theme-color"]': world.without === 'theme-color' ? null : element('theme-color', color),
  }
  const document = strict('document', {
    documentElement: element('html', html),
    querySelector: (selector: string) => {
      if (world.selectors === 'throw') throw new Error('no selectors')
      if (!Object.hasOwn(metas, selector)) {
        strays.push(`document.querySelector('${selector}')`)
        throw new Error(`a selector this browser does not know: ${selector}`)
      }
      return metas[selector]
    },
  })
  const localStorage =
    world.storage === 'missing'
      ? undefined
      : strict('localStorage', {
          getItem: (key: string) => {
            if (world.storage === 'throws') throw new Error('blocked')
            return key === 'tcg.look' ? world.stored : null
          },
          setItem: () => {
            writes += 1
          },
          removeItem: () => {
            writes += 1
          },
        })
  const matchMedia =
    world.media === 'missing'
      ? undefined
      : (query: string) => {
          if (world.media === 'throws') throw new Error('no media queries')
          const listen = () => {
            listeners += 1
          }
          return strict('MediaQueryList', {
            matches: query === '(prefers-color-scheme: light)' && world.system === 'light',
            addEventListener: listen,
            addListener: listen,
          })
        }
  const globals: Record<string, unknown> = {
    window: strict('window', { matchMedia, localStorage, document }),
    document,
    localStorage,
    JSON,
  }
  // Under `with`, every name the script does not declare is looked up here and never in node's own globals.
  const scope = new Proxy(globals, {
    has: () => true,
    get(target, key) {
      if (typeof key === 'symbol') return undefined
      if (Object.hasOwn(target, key)) return target[key]
      strays.push(key)
      throw new ReferenceError(`${key} is not defined`)
    },
    set(_target, key) {
      strays.push(`${String(key)} = …`)
      return false
    },
  })
  const outcome: Outcome = { threw: false, theme: null, scheme: null, color: null }
  try {
    new Function('scope', `with (scope) {\n${code}\n}`)(scope)
  } catch {
    outcome.threw = true
  }
  outcome.theme = html.get('data-theme') ?? null
  outcome.scheme = world.without === 'color-scheme' ? null : (scheme.get('content') ?? null)
  outcome.color = world.without === 'theme-color' ? null : (color.get('content') ?? null)
  return { outcome, calls, strays, writes, listeners }
}

const CASES: (World & { name: string; expected: Theme })[] = [
  { name: 'nothing stored', stored: null, system: 'light', expected: 'dark' },
  { name: 'invalid JSON', stored: '{"theme":', system: 'light', expected: 'dark' },
  { name: 'null', stored: 'null', system: 'light', expected: 'dark' },
  { name: 'an array', stored: '["light"]', system: 'light', expected: 'dark' },
  { name: 'a number', stored: '7', system: 'light', expected: 'dark' },
  { name: 'a string, not an object', stored: '"light"', system: 'light', expected: 'dark' },
  { name: 'an object without a theme', stored: '{}', system: 'light', expected: 'dark' },
  { name: 'dark on a light system', stored: '{"theme":"dark"}', system: 'light', expected: 'dark' },
  { name: 'light on a dark system', stored: '{"theme":"light"}', system: 'dark', expected: 'light' },
  { name: 'system on a light system', stored: '{"theme":"system"}', system: 'light', expected: 'light' },
  { name: 'system on a dark system', stored: '{"theme":"system"}', system: 'dark', expected: 'dark' },
  { name: 'a theme that does not exist', stored: '{"theme":"sepia"}', system: 'light', expected: 'dark' },
  // Close to a valid one, and still not it: the two scripts compare the exact text, nothing is tidied up first.
  { name: 'LIGHT in capitals', stored: '{"theme":"LIGHT"}', system: 'light', expected: 'dark' },
  { name: 'System with a capital', stored: '{"theme":"System"}', system: 'light', expected: 'dark' },
  { name: 'light after a space', stored: '{"theme":" light"}', system: 'light', expected: 'dark' },
  { name: 'system before a space', stored: '{"theme":"system "}', system: 'light', expected: 'dark' },
  { name: 'light inside an array', stored: '{"theme":["light"]}', system: 'light', expected: 'dark' },
  { name: 'system inside an array', stored: '{"theme":["system"]}', system: 'light', expected: 'dark' },
  { name: 'true as the theme', stored: '{"theme":true}', system: 'light', expected: 'dark' },
  { name: 'null as the theme', stored: '{"theme":null}', system: 'light', expected: 'dark' },
  { name: 'the text true', stored: 'true', system: 'light', expected: 'dark' },
  { name: 'an empty text', stored: '', system: 'light', expected: 'dark' },
  {
    name: 'light next to the motion and the views',
    stored: '{"theme":"light","motion":"none","views":"top"}',
    system: 'dark',
    expected: 'light',
  },
  { name: 'a storage that throws', stored: '{"theme":"light"}', system: 'light', storage: 'throws', expected: 'dark' },
  { name: 'no storage at all', stored: null, system: 'light', storage: 'missing', expected: 'dark' },
  {
    name: 'system without matchMedia',
    stored: '{"theme":"system"}',
    system: 'light',
    media: 'missing',
    expected: 'dark',
  },
  {
    name: 'light without matchMedia',
    stored: '{"theme":"light"}',
    system: 'dark',
    media: 'missing',
    expected: 'light',
  },
  {
    name: 'system with a matchMedia that throws',
    stored: '{"theme":"system"}',
    system: 'light',
    media: 'throws',
    expected: 'dark',
  },
  {
    name: 'light with a matchMedia that throws',
    stored: '{"theme":"light"}',
    system: 'dark',
    media: 'throws',
    expected: 'light',
  },
  {
    name: 'light without the color-scheme meta',
    stored: '{"theme":"light"}',
    system: 'dark',
    without: 'color-scheme',
    expected: 'light',
  },
  {
    name: 'light without the theme-color meta',
    stored: '{"theme":"light"}',
    system: 'dark',
    without: 'theme-color',
    expected: 'light',
  },
  {
    name: 'dark without the color-scheme meta',
    stored: null,
    system: 'light',
    without: 'color-scheme',
    expected: 'dark',
  },
  {
    name: 'dark without the theme-color meta',
    stored: null,
    system: 'light',
    without: 'theme-color',
    expected: 'dark',
  },
  {
    name: 'light with selectors that throw',
    stored: '{"theme":"light"}',
    system: 'dark',
    selectors: 'throw',
    expected: 'light',
  },
  { name: 'dark with selectors that throw', stored: null, system: 'light', selectors: 'throw', expected: 'dark' },
]

describe('the theme before the first paint: the page’s script and the app’s look.js', () => {
  it.each(CASES)('$name → $expected, by both', (world) => {
    const { expected } = world
    const page = inFakeBrowser(THEME_SCRIPT, world, expected)
    const app = inFakeBrowser(LOOK_JS, world, expected)
    // The colour of the browser's bars is the page's background in that theme.
    const background = tokensOf(expected).get('--background') ?? ''
    // A meta that is not there has nothing to hold; one nobody could look for keeps what it had.
    const reached = world.selectors !== 'throw'
    const wanted: Outcome = {
      threw: false,
      theme: expected,
      scheme: world.without === 'color-scheme' ? null : reached ? expected : untouched(expected).scheme,
      color: world.without === 'theme-color' ? null : reached ? background : untouched(expected).color,
    }
    // If look.js changes its rules this fails, until the case is rewritten and the login follows.
    expect(app.outcome).toEqual(wanted)
    expect(page.outcome).toEqual(app.outcome)
    // Neither reaches for anything this browser does not have.
    expect(app.strays).toEqual([])
    expect(page.strays).toEqual([])
    // The page: the theme only, resolved once. These calls and no other, each with one of the values written in the
    // script and never with what was stored; the motion and the views are the app's, nothing is written or watched.
    expect(page.calls).toEqual([
      ['html', 'data-theme', expected],
      ...(reached && world.without !== 'color-scheme' ? [['color-scheme', 'content', expected]] : []),
      ...(reached && world.without !== 'theme-color' ? [['theme-color', 'content', background]] : []),
    ])
    expect(page.writes).toBe(0)
    expect(page.listeners).toBe(0)
  })
})

describe('the palette of the page', () => {
  it.each(THEMES)('carries the %s tokens of the app by value', (theme) => {
    const mine = only(PAGE, BLOCK[theme]).declarations
    const app = only(APP, BLOCK[theme]).declarations
    expect(mine.get('color-scheme')).toBe(theme)
    expect(mine.size).toBeGreaterThan(1)
    for (const [name, value] of mine) expect(value, `${name} in the ${theme} theme`).toBe(app.get(name))
  })

  it('declares every token it uses, and overrides in the light theme the ones index.css overrides', () => {
    const used = [...new Set([...STYLE.matchAll(/var\((--[\w-]+)/g)].map((found) => found[1] ?? ''))].sort()
    const dark = [...customProperties(only(PAGE, BLOCK.dark)).keys()]
    const light = [...customProperties(only(PAGE, BLOCK.light)).keys()]
    const lightOfTheApp = customProperties(only(APP, BLOCK.light))
    expect(dark.toSorted()).toEqual(used)
    // A token index.css leaves alone in the light theme (--radius, --frame) is inherited here too; none is forgotten.
    expect(light.toSorted()).toEqual(dark.filter((name) => lightOfTheApp.has(name)).sort())
    expect(light.length).toBeLessThan(dark.length)
  })

  it('writes no colour outside the two token blocks, follows no system scheme and loads nothing', () => {
    expect(OUTSIDE_THE_TOKENS.length).toBeGreaterThan(10)
    for (const rule of OUTSIDE_THE_TOKENS) {
      for (const [property, value] of rule.declarations) {
        const where = `${rule.prelude} { ${property}: ${value} }`
        const bare = value.replace(/"[^"]*"|'[^']*'/g, '')
        expect(bare, where).not.toMatch(/#[0-9a-f]{3,8}\b/i)
        expect(bare, where).not.toMatch(/(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i)
        expect(
          bare
            .toLowerCase()
            .split(/[^a-z-]+/)
            .filter((word) => NAMED_COLOURS.has(word)),
          where,
        ).toEqual([])
      }
    }
    expect(STYLE).not.toContain('prefers-color-scheme')
    expect(STYLE).not.toContain('url(')
    expect(STYLE).not.toContain('@import')
    // A style attribute would paint past everything these tests read.
    expect(html).not.toMatch(/\sstyle\s*=/i)
  })

  it('uses the faces of the device through the fallback chain of the app', () => {
    const theme = only(APP, '@theme inline').declarations
    expect(declared('h1', 'font-family')).toBe(theme.get('--font-heading'))
    expect(declared('label', 'font-family')).toBe(theme.get('--font-heading'))
    expect(declared('button', 'font-family')).toBe(theme.get('--font-heading'))
    expect(declared('body', 'font-family')).toBe(theme.get('--font-sans'))
    // What is typed is running text, not a label.
    expect(declared('input', 'font-family')).toBe('inherit')

    const faces = (css: Rule) =>
      css.rules
        .filter((rule) => rule.prelude === '@font-face')
        .map((rule) => Object.fromEntries(rule.declarations))
        .filter((face) => /Fallback/.test(face['font-family'] ?? ''))
    // The two stand-ins made of local() faces, as index.css writes them; the faces the app serves are not loaded.
    expect(faces(PAGE)).toHaveLength(2)
    expect(faces(PAGE)).toEqual(faces(APP))
    expect(PAGE.rules.filter((rule) => rule.prelude === '@font-face')).toHaveLength(2)
  })
})

describe('the shapes of the page', () => {
  it('has fields and a button of 44 px, 16 px in the fields, and nothing under 13 px, all of it in rem', () => {
    // In rem, as the app: a person who set a bigger font size in the browser gets a bigger login too.
    expect(px(declared('input', 'height'), 'the height of a field')).toBe(44)
    // 16 px: under it iOS zooms into the field that takes the focus.
    expect(px(declared('input', 'font-size'), 'the text of a field')).toBe(16)
    expect(px(declared('button', 'min-height'), 'the height of the button')).toBeGreaterThanOrEqual(44)
    expect(declared('button[disabled]', 'cursor')).toBe('wait')
    expect(Number(declared('button[disabled]', 'opacity'))).toBeLessThan(1)

    const sizes = OUTSIDE_THE_TOKENS.flatMap((rule) => {
      // The shorthand would hide a size from this test.
      expect(rule.declarations.has('font'), rule.prelude).toBe(false)
      const size = rule.declarations.get('font-size')
      return size === undefined ? [] : [{ where: rule.prelude, size }]
    })
    expect(sizes.length).toBeGreaterThan(4)
    for (const { where, size } of sizes) expect(px(size, where), where).toBeGreaterThanOrEqual(13)
  })

  it('draws nothing under 13 px through the stand-in faces, and asks them for no bold in labels or the button', () => {
    // The page never gets the display face, so what the app shows for a moment is what the login always shows: on a
    // device without a narrow face, the wide stand-in, drawn smaller than the size asked for.
    const wide = PAGE.rules.find((rule) => rule.declarations.get('font-family') === '"TCG Wide Fallback"')
    const drawn = Number.parseFloat(wide?.declarations.get('size-adjust') ?? '') / 100
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThan(1)
    for (const selector of ['h1', 'label', 'button']) {
      expect(declared(selector, 'font-family'), selector).toContain('"TCG Wide Fallback"')
      expect(px(declared(selector, 'font-size'), selector) * drawn, selector).toBeGreaterThanOrEqual(13)
    }
    // Both stand-ins are one regular face: 500 (the app's `font-medium` for a label and a button) is drawn with it as
    // it is, and from 600 up the browser would fake the bold.
    expect(declared('label', 'font-weight')).toBe('500')
    expect(declared('button', 'font-weight')).toBe('500')
  })

  it('keeps the card, the fields and the button as the app draws them', () => {
    const theme = only(APP, '@theme inline').declarations
    expect(declared('main', 'background')).toBe('var(--card)')
    expect(declared('main', 'border')).toBe('1px solid var(--border)')
    expect(declared('main', 'box-shadow')).toBe('inset 0 1px 0 var(--edge), var(--shadow-card)')
    // `rounded-xl` for a card (about 16 px), `rounded-lg` for a field and a button (12 px).
    expect(declared('main', 'border-radius')).toBe(theme.get('--radius-xl'))
    expect(declared('input', 'background')).toBe('var(--surface-2)')
    expect(declared('input', 'border')).toBe('1px solid var(--input)')
    expect(declared('input', 'border-radius')).toBe(theme.get('--radius-lg'))
    expect(declared('button', 'background')).toBe('var(--primary)')
    expect(declared('button', 'color')).toBe('var(--primary-foreground)')
    expect(declared('button', 'border-radius')).toBe(theme.get('--radius-lg'))
    // The contrast below counts on these two: the browser does not dim the placeholder again, and the error box is
    // told from the card by more than its tint.
    expect(declared('input::placeholder', 'opacity')).toBe('1')
    expect(declared('.error', 'border')).toBe('1px solid var(--destructive)')
  })

  it('gives the button an edge where the system forces its colours', () => {
    // Forced colours drop every fill: without an edge «Entrar» is a bare word. No colour is written: the system
    // paints the edge with its own, as it does with the app's button (which carries a transparent one).
    expect(declared('button', 'border')).toBe('0')
    expect(declared('button', 'border', only(PAGE, '@media (forced-colors: active)'))).toBe('1px solid')
  })

  it('stands in the column of the app, with the colour of the app around it, clear of the edges of the screen', () => {
    const base = only(APP, '@layer base')
    const column = only(base, '#root').declarations
    const around = only(base, 'html').declarations
    // What the app gives #root, the page gives <body>: on a wide window nothing changes shade or place on the way in.
    for (const property of ['max-width', 'min-height', 'background']) {
      expect(declared('body', property), property).toBe(column.get(property))
    }
    expect(declared('body', 'margin')).toBe('0 auto')
    for (const property of ['background', 'scrollbar-gutter']) {
      expect(declared('html', property), property).toBe(around.get(property))
    }
    const wide = '@media (min-width: 600px)'
    expect(declared('body', 'box-shadow', only(PAGE, wide))).toBe(
      only(only(base, wide), '#root').declarations.get('box-shadow'),
    )
    // viewport-fit=cover lets the page under the notch and the rounded corners: 16 px, or what the device asks for.
    expect(html).toContain('viewport-fit=cover')
    expect(declared('body', 'padding')).toBe(
      ['top', 'right', 'bottom', 'left'].map((side) => `max(16px, env(safe-area-inset-${side}))`).join(' '),
    )
  })

  it('has no rule, and paints with none, that the contrast below does not count', () => {
    // A new rule can change what is painted without changing a colour: whoever adds one comes by here, and then
    // by `surfaces` and the two lists of «contrast».
    expect(PAGE.rules.flatMap(nested).map((rule) => rule.prelude)).toEqual([
      '@font-face',
      '@font-face',
      ':root',
      ':root[data-theme="light"]',
      '*',
      'html',
      'body',
      '@media (min-width: 600px)',
      'body',
      'main',
      'h1, label, button',
      'h1',
      '.sub',
      'label',
      'input',
      'input::placeholder',
      'input:focus-visible',
      'button',
      'button:focus-visible',
      'button:active',
      'button[disabled]',
      '@media (hover: hover)',
      'button:hover:not([disabled])',
      '@media (forced-colors: active)',
      'button',
      '.error',
      '.error[data-show]',
    ])
    expect(declaring('color')).toEqual(['body', '.sub', 'input', 'input::placeholder', 'button', '.error'])
    expect(declaring('background')).toEqual([
      'html',
      'body',
      'main',
      'input',
      'button',
      '@media (hover: hover) / button:hover:not([disabled])',
      '.error',
    ])
    // The two the contrast knows: a placeholder at full strength, and the button while the request is on its way
    // (dimmed on purpose: WCAG asks no contrast of a disabled control).
    expect(declaring('opacity')).toEqual(['input::placeholder', 'button[disabled]'])
    for (const property of [
      'background-color',
      'background-image',
      'filter',
      'backdrop-filter',
      'mix-blend-mode',
      '-webkit-text-fill-color',
    ]) {
      expect(declaring(property), property).toEqual([])
    }
  })
})

/** What is painted behind each thing in a theme: the window, the column, the card on it, and what sits on the card. */
function surfaces(theme: Theme) {
  const onTheCard = (...backgrounds: string[]) =>
    stack(
      theme,
      declared('html', 'background'),
      declared('body', 'background'),
      declared('main', 'background'),
      ...backgrounds,
    )
  return {
    card: onTheCard(),
    field: onTheCard(declared('input', 'background')),
    button: onTheCard(declared('button', 'background')),
    hovered: onTheCard(declared('button:hover:not([disabled])', 'background', only(PAGE, '@media (hover: hover)'))),
    alert: onTheCard(declared('.error', 'background')),
  }
}

describe.each(THEMES)('contrast in the %s theme', (theme) => {
  it('every text reads at 4.5:1 or more on what is behind it', () => {
    const { card, field, button, hovered, alert } = surfaces(theme)
    const texts: [what: string, text: Rgb, behind: Rgb][] = [
      ['the title', ink(theme, 'color', 'h1', 'body'), card],
      ['the text under the title', ink(theme, 'color', '.sub'), card],
      ['a label', ink(theme, 'color', 'label', 'body'), card],
      ['what is typed in a field', ink(theme, 'color', 'input'), field],
      ['the placeholder of a field', ink(theme, 'color', 'input::placeholder'), field],
      ['the button', ink(theme, 'color', 'button'), button],
      ['the button under the pointer', ink(theme, 'color', 'button'), hovered],
      ['the error', ink(theme, 'color', '.error'), alert],
    ]
    for (const [what, text, behind] of texts) expect(contrast(text, behind), what).toBeGreaterThanOrEqual(4.5)
  })

  it('the edge of a field and the focus ring stand at 3:1 or more against what surrounds them', () => {
    const { card, field } = surfaces(theme)
    const edge = ink(theme, 'border', 'input')
    expect(contrast(edge, card), 'the edge of a field, from the card').toBeGreaterThanOrEqual(3)
    expect(contrast(edge, field), 'the edge of a field, from its fill').toBeGreaterThanOrEqual(3)

    // A focused field: its edge turns into the ring, 2 px more around it.
    expect(declared('input:focus-visible', 'border-color')).toBe('var(--ring)')
    expect(declared('input:focus-visible', 'outline')).toBe('2px solid var(--ring)')
    const ring = ink(theme, 'outline', 'input:focus-visible')
    expect(contrast(ring, card), 'the ring of a field, from the card').toBeGreaterThanOrEqual(3)
    expect(contrast(ring, field), 'the ring of a field, from its fill').toBeGreaterThanOrEqual(3)

    // The button's fill is the text colour, which the ring does not stand against in the dark theme: its ring is
    // drawn apart, with the card on both sides.
    expect(declared('button:focus-visible', 'outline')).toBe('2px solid var(--ring)')
    expect(Number.parseFloat(declared('button:focus-visible', 'outline-offset'))).toBeGreaterThanOrEqual(2)
    expect(
      contrast(ink(theme, 'outline', 'button:focus-visible'), card),
      'the ring of the button',
    ).toBeGreaterThanOrEqual(3)
  })
})

/**
 * A JavaScript data literal, parsed — never evaluated (Fase 40, security): the tracker's `CardsDB.ts` declares its
 * `expansions` and `craftingCost` as object and array literals, and «Actualizar al último del tracker» reads them from
 * a commit nobody reviewed yet. Evaluating that text (`new Function`) would run whatever someone landed there inside
 * the API. This accepts exactly what those literals use — objects (bare, single- or double-quoted keys), arrays,
 * strings, numbers, `true`, `false`, `null`, `//` and `/* *\/` comments and trailing commas — and nothing else: no
 * identifiers as values, no calls, operators, template literals or spreads.
 */

export class LiteralParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiteralParseError'
  }
}

/** Keys that would reach an object's prototype. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_DEPTH = 64
const MAX_LENGTH = 2_000_000

export function parseJsLiteral(text: string): unknown {
  if (text.length > MAX_LENGTH) throw new LiteralParseError(`literal too long (${text.length} characters)`)
  let at = 0

  const fail = (message: string): never => {
    const line = text.slice(0, at).split('\n').length
    throw new LiteralParseError(`${message} (line ${line})`)
  }

  const skip = () => {
    for (;;) {
      const char = text[at]
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '﻿') {
        at += 1
      } else if (char === '/' && text[at + 1] === '/') {
        while (at < text.length && text[at] !== '\n') at += 1
      } else if (char === '/' && text[at + 1] === '*') {
        const end = text.indexOf('*/', at + 2)
        if (end < 0) fail('unterminated comment')
        at = end + 2
      } else {
        return
      }
    }
  }

  const string = (): string => {
    const quote = text[at]
    at += 1
    let out = ''
    while (at < text.length) {
      const char = text[at] as string
      if (char === quote) {
        at += 1
        return out
      }
      if (char === '\n') fail('line break inside a string')
      if (char === '\\') {
        const next = text[at + 1]
        at += 2
        if (next === 'n') out += '\n'
        else if (next === 't') out += '\t'
        else if (next === 'r') out += '\r'
        else if (next === 'b') out += '\b'
        else if (next === 'f') out += '\f'
        else if (next === 'v') out += '\v'
        else if (next === '0') out += '\0'
        else if (next === 'u' || next === 'x') {
          const size = next === 'u' ? 4 : 2
          const hex = text.slice(at, at + size)
          if (!new RegExp(`^[0-9a-fA-F]{${size}}$`).test(hex)) fail('bad escape')
          out += String.fromCharCode(Number.parseInt(hex, 16))
          at += size
        } else if (next === '\n') {
          // a line continuation
        } else if (next !== undefined) out += next
        else fail('unterminated string')
      } else {
        out += char
        at += 1
      }
    }
    return fail('unterminated string')
  }

  const number = (): number => {
    const match = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(at))
    if (!match) return fail('bad number')
    at += match[0].length
    return Number(match[0])
  }

  const key = (): string => {
    const char = text[at]
    let name: string
    if (char === "'" || char === '"') name = string()
    else if (char !== undefined && /[0-9]/.test(char)) name = String(number())
    else {
      const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(at))
      if (!match) return fail('expected a key')
      name = match[0]
      at += name.length
    }
    if (FORBIDDEN_KEYS.has(name)) fail(`key «${name}» is not allowed`)
    return name
  }

  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) fail('literal nested too deep')
    skip()
    const char = text[at]
    if (char === '{') {
      at += 1
      const out: Record<string, unknown> = {}
      skip()
      while (text[at] !== '}') {
        const name = key()
        skip()
        if (text[at] !== ':') fail('expected «:»')
        at += 1
        out[name] = value(depth + 1)
        skip()
        if (text[at] === ',') {
          at += 1
          skip()
        } else if (text[at] !== '}') fail('expected «,» or «}»')
      }
      at += 1
      return out
    }
    if (char === '[') {
      at += 1
      const out: unknown[] = []
      skip()
      while (text[at] !== ']') {
        out.push(value(depth + 1))
        skip()
        if (text[at] === ',') {
          at += 1
          skip()
        } else if (text[at] !== ']') fail('expected «,» or «]»')
      }
      at += 1
      return out
    }
    if (char === "'" || char === '"') return string()
    if (char !== undefined && /[-.0-9]/.test(char)) return number()
    for (const [word, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(word, at) && !/[\w$]/.test(text[at + word.length] ?? '')) {
        at += word.length
        return result
      }
    }
    return fail(char === undefined ? 'unexpected end' : `unexpected «${char}»: only data literals are read`)
  }

  const result = value(0)
  skip()
  if (at < text.length) fail(`unexpected «${text[at]}» after the literal`)
  return result
}

#!/usr/bin/env node
// Chat between the Claude sessions that work on this app (D-021), kept in the app itself so the cloud sessions,
// which only reach it through the MCP, are in it too (`chat_read` / `chat_write`). Same commands as the
// coordinator's `tcg-pocket-chat/chat.mjs`:
//
//   node scripts/chat.mjs write --from Coordinador --to Principal[,Laboratorio|todos] --topic "…" [--text "…"]
//                                (without --text, the message is read from stdin)
//   node scripts/chat.mjs read --as Principal [--all] [--limit 30]
//   node scripts/chat.mjs wait --as Principal [--minutes 60]   (waits for a new message, prints it and exits)
//
// It talks to `/api/mcp/chat` with an MCP token that has `mcp:write` (Más → Tokens de API):
//   TCG_CHAT_TOKEN (or TCG_MCP_TOKEN) and TCG_SERVER (by default https://tcg-pocket.fly.dev).
// Exit codes: 0 ok, 1 error, 2 `wait` ended without messages.

const WAIT_STEP_SECONDS = 40

function options(argv) {
  const out = { _: [] }
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[at + 1]
    if (next === undefined || next.startsWith('--')) out[name] = true
    else {
      out[name] = next
      at++
    }
  }
  return out
}

function fail(message) {
  process.stderr.write(`chat: ${message}\n`)
  process.exit(1)
}

const opts = options(process.argv.slice(2))
const command = opts._[0]
const server = String(opts.server ?? process.env.TCG_SERVER ?? 'https://tcg-pocket.fly.dev').replace(/\/+$/, '')
const token = process.env.TCG_CHAT_TOKEN ?? process.env.TCG_MCP_TOKEN

async function call(method, path, body) {
  if (!token) fail('falta el token: TCG_CHAT_TOKEN (un token MCP con mcp:write, Más → Tokens de API).')
  const response = await fetch(`${server}/api/mcp/chat${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) fail(`${response.status} ${data?.error?.message ?? text}`)
  return data
}

/** «9/10 15:02» in Buenos Aires, like the rest of the app. */
function when(iso) {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`
}

function print(messages) {
  for (const message of messages) {
    process.stdout.write(
      `— #${message.id} ${when(message.at)} · ${message.from} → ${message.to.join(', ')} · ${message.topic}\n${message.text}\n\n`,
    )
  }
}

async function stdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const query = (params) =>
  `?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined)).toString()}`

if (command === 'write') {
  if (!opts.from || !opts.to || !opts.topic) fail('write necesita --from, --to y --topic.')
  const text = typeof opts.text === 'string' ? opts.text : await stdin()
  if (!text.trim()) fail('el mensaje está vacío (--text o por stdin).')
  const sent = await call('POST', '', { from: opts.from, to: String(opts.to), topic: opts.topic, text })
  process.stdout.write(`✓ #${sent.id} ${when(sent.at)} · ${sent.from} → ${sent.to.join(', ')}\n`)
} else if (command === 'read') {
  if (!opts.as) fail('read necesita --as.')
  const view = await call('GET', query({ as: opts.as, all: opts.all ? 'true' : undefined, limit: opts.limit }))
  if (view.messages.length === 0) process.stdout.write('Sin mensajes nuevos.\n')
  print(view.messages)
  if (view.unreadLeft > 0) process.stdout.write(`(quedan ${view.unreadLeft} sin leer: volvé a correr read)\n`)
} else if (command === 'wait') {
  if (!opts.as) fail('wait necesita --as.')
  const deadline = Date.now() + Number(opts.minutes ?? 60) * 60_000
  while (Date.now() < deadline) {
    const seconds = Math.max(1, Math.min(WAIT_STEP_SECONDS, Math.ceil((deadline - Date.now()) / 1000)))
    const view = await call('GET', query({ as: opts.as, wait: String(seconds) }))
    if (view.messages.length > 0) {
      print(view.messages)
      process.exit(0)
    }
  }
  process.stdout.write('Sin mensajes en el tiempo de espera.\n')
  process.exit(2)
} else {
  fail('uso: chat.mjs write|read|wait (ver el encabezado del archivo).')
}

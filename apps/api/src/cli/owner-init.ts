/**
 * `pnpm -F @tcg/api owner:init [--no-totp]`
 * Creates or updates the single owner from OWNER_EMAIL / OWNER_PASSWORD and (unless --no-totp) enrolls a new TOTP
 * secret, printing the otpauth:// URI and the base32 secret once. Every existing session is closed.
 */
import { parseArgs } from 'node:util'
import { OwnerService } from '../auth/owner.service.js'
import { hashPassword } from '../auth/password.js'
import { SessionService } from '../auth/session.service.js'
import { currentTotp, generateTotpSecret, totpUri } from '../auth/totp.js'
import { createCliContext } from './context.js'

const { values } = parseArgs({
  options: { 'no-totp': { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
  strict: true,
})

if (values.help) {
  console.log(
    'Usage: owner:init [--no-totp]\n  OWNER_EMAIL and OWNER_PASSWORD (>= 12 characters) come from the environment or .env.',
  )
  process.exit(0)
}

const { context } = await createCliContext()
try {
  const email = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.OWNER_PASSWORD ?? ''
  if (!email.includes('@')) throw new Error('OWNER_EMAIL is missing or invalid')
  if (password.length < 12 || password === 'change-me') {
    throw new Error('OWNER_PASSWORD must have at least 12 characters (and not be the example value)')
  }
  const owners = context.get(OwnerService)
  const sessions = context.get(SessionService)
  const existing = await owners.get()
  const totpSecret = values['no-totp'] ? null : generateTotpSecret()
  await owners.upsert({ email, passwordHash: await hashPassword(password), totpSecret })
  const closed = await sessions.destroyAllExcept(null)

  console.log(`${existing ? 'Updated' : 'Created'} owner ${email} (${closed} session(s) closed).`)
  if (totpSecret === null) {
    console.log('TOTP disabled (--no-totp): login needs only the password.')
  } else {
    console.log('\nEnroll this secret in your authenticator app (shown once, not stored in clear):')
    console.log(`  secret: ${totpSecret}`)
    console.log(`  uri:    ${totpUri(email, totpSecret)}`)
    console.log(`  current code (to check the clock): ${await currentTotp(totpSecret)}`)
  }
} finally {
  await context.close()
}

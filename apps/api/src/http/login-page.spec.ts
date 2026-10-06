import { renderLoginPage } from './login-page.js'

describe('renderLoginPage', () => {
  const html = renderLoginPage({ nonce: 'abc123' })

  it('is a Spanish page with the three fields and the nonce on its only script', () => {
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('id="email"')
    expect(html).toContain('id="password"')
    expect(html).toContain('id="totp"')
    expect(html).toContain('<script nonce="abc123">')
    expect(html.match(/<script/g)).toHaveLength(1)
  })

  it('loads no external assets and posts JSON to /api/auth/login', () => {
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+(src|href)=["']https?:/)
    expect(html).not.toContain('@import')
    expect(html).toContain("fetch('/api/auth/login'")
    expect(html).toContain("window.location.replace('/')")
  })
})

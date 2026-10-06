import { SecretBox, SecretBoxError } from './secret-box.js'

const secret = 'test-session-secret-test-session-secret-0123456789'

describe('SecretBox', () => {
  it('round-trips a value with a fresh iv every time', () => {
    const box = new SecretBox(secret)
    const sealedA = box.seal('JBSWY3DPEHPK3PXP')
    const sealedB = box.seal('JBSWY3DPEHPK3PXP')
    expect(sealedA).not.toBe(sealedB)
    expect(sealedA).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(box.open(sealedA)).toBe('JBSWY3DPEHPK3PXP')
    expect(box.open(sealedB)).toBe('JBSWY3DPEHPK3PXP')
  })

  it('rejects tampered values, other keys and other purposes', () => {
    const box = new SecretBox(secret)
    const sealed = box.seal('hello')
    const [v, iv, ct, tag] = sealed.split('.') as [string, string, string, string]
    const flipped = `${ct.slice(0, -1)}${ct.endsWith('A') ? 'B' : 'A'}`
    expect(() => box.open([v, iv, flipped, tag].join('.'))).toThrow(SecretBoxError)
    expect(() => new SecretBox(`${secret}-other`).open(sealed)).toThrow(SecretBoxError)
    expect(() => new SecretBox(secret, 'another-purpose').open(sealed)).toThrow(SecretBoxError)
    expect(() => box.open('v0.a.b.c')).toThrow(SecretBoxError)
    expect(() => box.open('garbage')).toThrow(SecretBoxError)
  })

  it('refuses short secrets', () => {
    expect(() => new SecretBox('short')).toThrow(SecretBoxError)
  })
})

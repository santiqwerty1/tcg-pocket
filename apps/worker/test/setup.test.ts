import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launcherScript } from '../src/autostart.js'
import { prompter } from '../src/portable.js'

describe('worker setup (D-026, after the 11/10 migration)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads every answer of a redirected stdin in order, and Enter for the ones that are missing', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    // All the answers arrive at once, before the first question (a file redirected to stdin).
    input.end('tcg_wk_test\n8\nRyzen\n')
    const prompt = prompter(input, output)
    expect(await prompt.ask('token: ')).toBe('tcg_wk_test')
    expect(await prompt.ask('hilos: ')).toBe('8')
    expect(await prompt.ask('nombre: ')).toBe('Ryzen')
    // EOF: Enter, never a hang or a crash.
    expect(await prompt.ask('¿Lo detengo? ')).toBe('')
    expect(await prompt.ask('Enter para cerrar.')).toBe('')
    prompt.close()
  })

  it('the launcher carries a data folder chosen with TCG_WORKER_DIR (a worker started at logon has no other way)', () => {
    vi.stubEnv('TCG_WORKER_DIR', '')
    const plain = launcherScript(['C:\\w\\tcg-worker.exe', '--run'])
    expect(plain).toBe(
      'Set shell = CreateObject("WScript.Shell")\r\nshell.Run """C:\\w\\tcg-worker.exe"" ""--run""", 0, False\r\n',
    )
    vi.stubEnv('TCG_WORKER_DIR', 'C:\\data "x"')
    const custom = launcherScript(['C:\\w\\tcg-worker.exe', '--run'])
    expect(custom).toContain('shell.Environment("Process")("TCG_WORKER_DIR") = "C:\\data ""x"""\r\n')
    expect(custom.indexOf('Environment')).toBeLessThan(custom.indexOf('shell.Run'))
  })
})

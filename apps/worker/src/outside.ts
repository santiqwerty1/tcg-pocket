/**
 * Acting from outside a packaged app (Windows). The Claude desktop app is an MSIX package, and so is everything a
 * session runs: a new folder or file directly under %LOCALAPPDATA% or %APPDATA% lands in the package's private copy
 * (`AppData\Local\Packages\<app>\LocalCache`), which nothing outside the app sees; inside folders that already exist
 * (the Startup folder, TEMP, an existing `tcg-worker`) writes are real, but a file the app wrote privately shadows the
 * real one for the app only (measured on 11/10/2026). And a process the app starts lives and dies with it (H-016).
 * Processes created through WMI (Win32_Process.Create) run outside the package: setup relaunches itself that way
 * (`portable.ts`), so it reads and writes what the real worker will.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** A PowerShell command line with the script encoded: no quoting, `%` or `$` expansion of what it carries. */
export function encodedPowershell(script: string): string {
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

function powershell(script: string): { ok: boolean; stdout: string } {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
  )
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() }
}

/** A PowerShell single-quoted string. */
export const literal = (text: string) => `'${text.replace(/'/g, "''")}'`

/** Starts `commandLine` through WMI, outside any package; its PID, or null if WMI refused. */
export function startOutside(commandLine: string): number | null {
  const { ok, stdout } = powershell(
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${literal(commandLine)} }; "$($r.ReturnValue) $($r.ProcessId)"`,
  )
  const [code, pid] = stdout.split(' ').map(Number)
  return ok && code === 0 && pid ? pid : null
}

const running = (pid: number) =>
  powershell(`[bool](Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}")`).stdout === 'True'

/** Runs `commandLine` outside and waits for it to end (up to `timeoutMs`); false if it could not start or timed out. */
export async function runOutside(commandLine: string, timeoutMs = 30_000): Promise<boolean> {
  const pid = startOutside(commandLine)
  if (pid === null) return false
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (!running(pid)) return true
    await sleep(300)
  }
  return false
}

/**
 * Whether this process runs inside a packaged app: a new folder it makes under %LOCALAPPDATA% is invisible to a
 * process outside. The answer comes back through TEMP (it already exists, so it is real for both).
 */
export async function insidePackage(): Promise<boolean> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return false
  const probe = join(process.env.LOCALAPPDATA, `tcg-worker-probe-${randomUUID()}`)
  const answer = join(tmpdir(), `tcg-worker-probe-${randomUUID()}.txt`)
  try {
    mkdirSync(probe)
    const done = await runOutside(
      encodedPowershell(
        `[IO.File]::WriteAllText(${literal(answer)}, [string](Test-Path -LiteralPath ${literal(probe)}))`,
      ),
    )
    // WMI unavailable: assume what we see is what the worker sees (the old behaviour).
    if (!done || !existsSync(answer)) return false
    return readFileSync(answer, 'utf8').trim() === 'False'
  } finally {
    rmSync(probe, { recursive: true, force: true })
    rmSync(answer, { force: true })
  }
}

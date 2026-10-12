/**
 * Acting from outside a packaged app (Windows). The Claude desktop app is an MSIX package, and so is everything a
 * session runs: a new folder or file directly under %LOCALAPPDATA% or %APPDATA% lands in the package's private copy
 * (`AppData\Local\Packages\<app>\LocalCache`), which nothing outside the app sees, while writes inside folders that
 * already exist (the Startup folder, TEMP, an existing `tcg-worker`) are real (measured on 11/10/2026). A process
 * the app starts also lives inside it and dies with it (H-016). Processes created through WMI (Win32_Process.Create)
 * run outside the package: setup uses them to check what the real worker will see, to write what it would not, and
 * to start the worker.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

function powershell(command: string): { ok: boolean; stdout: string } {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() }
}

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`

/** Starts `commandLine` through WMI, outside any package; its PID, or null if WMI refused. */
export function startOutside(commandLine: string): number | null {
  const { ok, stdout } = powershell(
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${quote(commandLine)} }; "$($r.ReturnValue) $($r.ProcessId)"`,
  )
  const [code, pid] = stdout.split(' ').map(Number)
  return ok && code === 0 && pid ? pid : null
}

const running = (pid: number) =>
  powershell(`[bool](Get-CimInstance Win32_Process -Filter "ProcessId=${pid}")`).stdout === 'True'

/** Runs `commandLine` outside and waits for it to end (up to `timeoutMs`). */
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
 * Which of `paths` a process outside the app sees. The answer comes back through TEMP, which is real (it already
 * exists). Off Windows everything is visible.
 */
export async function visibleOutside(paths: readonly string[]): Promise<boolean[]> {
  if (process.platform !== 'win32' || paths.length === 0) return paths.map(() => true)
  const answer = join(tmpdir(), `tcg-worker-probe-${randomUUID()}.txt`)
  const checks = paths.map((path, i) => `(if exist "${path}" (echo ${i}=1) else (echo ${i}=0))`).join(' & ')
  try {
    if (!(await runOutside(`cmd.exe /d /c (${checks}) > "${answer}"`)) || !existsSync(answer)) {
      // WMI unavailable: assume what we see is what the worker sees (the old behaviour).
      return paths.map(() => true)
    }
    const seen = new Map(
      readFileSync(answer, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim().split('='))
        .filter((parts) => parts.length === 2)
        .map(([i, flag]) => [Number(i), flag === '1'] as const),
    )
    return paths.map((_, i) => seen.get(i) ?? true)
  } finally {
    rmSync(answer, { force: true })
  }
}

/** Writes `content` to `path` from outside (creating its folder), so the real worker finds it. */
export async function writeOutside(path: string, content: string): Promise<boolean> {
  const data = Buffer.from(content, 'utf8').toString('base64')
  const script = `$p=${quote(path)}; New-Item -ItemType Directory -Force -Path (Split-Path -LiteralPath $p) | Out-Null; [IO.File]::WriteAllBytes($p, [Convert]::FromBase64String('${data}'))`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return runOutside(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`)
}

/** Whether this process runs inside a packaged app: a new folder it makes under %LOCALAPPDATA% is invisible outside. */
export async function insidePackage(): Promise<boolean> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return false
  const probe = join(process.env.LOCALAPPDATA, `tcg-worker-probe-${randomUUID()}`)
  try {
    mkdirSync(probe)
    const [seen] = await visibleOutside([probe])
    return seen === false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/** The processes running this very `exe` (by its path) with `argument`, inside a package or not. */
export function processesRunning(exe: string, argument: string): { pid: number; line: string }[] {
  const name = exe.split(/[\\/]/).pop() ?? exe
  const { stdout } = powershell(
    `Get-CimInstance Win32_Process -Filter "Name='${name}'" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`,
  )
  return stdout
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter(([pid, line]) => pid && line?.toLowerCase().includes(exe.toLowerCase()) && line.includes(argument))
    .map(([pid, line]) => ({ pid: Number(pid), line: line ?? '' }))
}

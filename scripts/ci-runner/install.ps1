# Runners propios de GitHub Actions en la PC (D-023): mientras el repo es privado y sin minutos de Actions, la CI corre
# acá. Instala N runners (por defecto 2) con la etiqueta «tcg-pc» en %USERPROFILE%\actions-runner\tcg-pc-<n>, sin
# servicio de Windows (no pide administrador), y un .vbs en Inicio que los arranca ocultos al iniciar sesión, como el
# worker. El token de registro sale de `gh` (dueño del repo) y nunca se muestra.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ci-runner\install.ps1 [-Count 2] [-Prefix tcg-pc]
#   powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1 [-Prefix tcg-pc]   (para sacarlos)
#
# En otra PC, otro prefijo (por ejemplo -Prefix tcg-ryzen): config.cmd --replace reemplaza por nombre, y con el mismo
# nombre se llevaría los runners de la primera PC. La etiqueta sigue siendo «tcg-pc», así la CI usa todos.
param([int]$Count = 2, [string]$Prefix = 'tcg-pc')
$ErrorActionPreference = 'Stop'

$Version = '2.338.0'
$Sha256 = 'f48e0750a21812bca5f82de5f7f5aeae71abee647fab5a582f1742d07eba455f'
$Repo = 'santiqwerty1/tcg-pocket'
$Base = Join-Path $env:USERPROFILE 'actions-runner'
$Zip = Join-Path $Base "actions-runner-win-x64-$Version.zip"
$Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\tcg-pocket-ci-runners.vbs'
$GitBin = 'C:\Program Files\Git\bin'

New-Item -ItemType Directory -Force $Base | Out-Null
if (-not (Test-Path $Zip)) {
  Write-Host "Bajando el runner $Version de github.com/actions/runner"
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/actions/runner/releases/download/v$Version/actions-runner-win-x64-$Version.zip" -OutFile $Zip
}
$hash = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $Sha256) { throw "El sha256 del runner no coincide ($hash): no se instala." }
Write-Host 'sha256 verificado'
if ($Prefix -notmatch '^[a-z0-9-]+$') { throw "El prefijo va en minúsculas, números y guiones: $Prefix" }
# What the jobs need on this PC, checked now so a missing piece does not show up later as a red job.
$missing = @()
if (-not (Test-Path (Join-Path $GitBin 'bash.exe'))) { $missing += "Git (bash en $GitBin): winget install --id Git.Git -e" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  $missing += 'GitHub CLI: winget install --id GitHub.cli -e; después gh auth login (cuenta dueña del repo)'
} else {
  gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { $missing += 'gh sin sesión: gh auth login (cuenta dueña del repo)' }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  $missing += 'Docker Desktop (el Postgres de la CI): winget install --id Docker.DockerDesktop -e, y abrirlo una vez'
}
if (-not (Test-Path (Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'))) {
  $missing += 'Rust: winget install --id Rustlang.Rustup -e; después rustup default stable-x86_64-pc-windows-gnu'
}
$winget = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
if (-not (Get-ChildItem $winget -Directory -Filter 'BrechtSanders.WinLibs*' -ErrorAction SilentlyContinue)) {
  $missing += 'WinLibs (compila el motor): winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e'
}
if ($missing) { throw ("Falta en esta PC:`n - " + ($missing -join "`n - ")) }
Write-Host 'Git, gh, Docker, Rust y WinLibs: presentes'

$token = gh api -X POST "repos/$Repo/actions/runners/registration-token" --jq .token
if (-not $token) { throw 'gh no devolvió el token de registro' }

foreach ($n in 1..$Count) {
  $name = "$Prefix-$n"
  $dir = Join-Path $Base $name
  if (-not (Test-Path (Join-Path $dir 'config.cmd'))) { Expand-Archive $Zip -DestinationPath $dir }
  # Already registered (a second run of this script): keep it, only refresh start.cmd and restart.
  if (-not (Test-Path (Join-Path $dir '.runner'))) {
    & (Join-Path $dir 'config.cmd') --unattended --url "https://github.com/$Repo" --token $token --name $name --labels 'tcg-pc' --work '_work' --replace | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "config.cmd falló para $name" }
  }
  # The jobs run with `shell: bash`: Git's bash first (WindowsApps\bash.exe is WSL's launcher).
  $pathFile = Join-Path $dir '.path'
  $current = if (Test-Path $pathFile) { (Get-Content $pathFile -Raw).Trim() } else { $env:PATH }
  if (-not $current.StartsWith($GitBin)) { Set-Content -Path $pathFile -Value "$GitBin;$current" -NoNewline -Encoding ascii }
  # Started through start.cmd, with Git's bash first in the PATH the runner (and its jobs) inherit: the .path file
  # alone was not enough, and `shell: bash` found WSL's launcher.
  Set-Content -Path (Join-Path $dir 'start.cmd') -Encoding ascii -Value (@(
    '@echo off',
    "set `"PATH=$GitBin;%PATH%`"",
    'call "%~dp0run.cmd"'
  ) -join "`r`n")
  Write-Host "Registrado $name"
}

# Runners already running (a second install) stop first, so they come back with the new start.cmd.
Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" |
  Where-Object { $_.ExecutablePath -like "$Base*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Start-Sleep -Seconds 2

# Started hidden at logon (and now, through WMI: a process started from a Claude session dies with the app, H-016).
$lines = @('Set shell = CreateObject("WScript.Shell")')
foreach ($n in 1..$Count) {
  $run = Join-Path (Join-Path $Base "$Prefix-$n") 'start.cmd'
  $lines += "shell.Run """"""$run"""""", 0, False"
}
Set-Content -Path $Startup -Value ($lines -join "`r`n") -Encoding ascii
$started = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "wscript.exe `"$Startup`"" }
Write-Host "Runners arrancados (WMI: $($started.ReturnValue)); arrancan solos al iniciar sesión ($Startup)."

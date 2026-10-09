# Runners propios de GitHub Actions en la PC (D-023): mientras el repo es privado y sin minutos de Actions, la CI corre
# acá. Instala N runners (por defecto 2) con la etiqueta «tcg-pc» en %USERPROFILE%\actions-runner\tcg-pc-<n>, sin
# servicio de Windows (no pide administrador), y un .vbs en Inicio que los arranca ocultos al iniciar sesión, como el
# worker. El token de registro sale de `gh` (dueño del repo) y nunca se muestra.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ci-runner\install.ps1 [-Count 2]
#   powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1      (para sacarlos)
param([int]$Count = 2)
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
if (-not (Test-Path (Join-Path $GitBin 'bash.exe'))) { throw "No está el bash de Git en $GitBin" }

$token = gh api -X POST "repos/$Repo/actions/runners/registration-token" --jq .token
if (-not $token) { throw 'gh no devolvió el token de registro' }

foreach ($n in 1..$Count) {
  $name = "tcg-pc-$n"
  $dir = Join-Path $Base $name
  if (-not (Test-Path (Join-Path $dir 'config.cmd'))) { Expand-Archive $Zip -DestinationPath $dir }
  & (Join-Path $dir 'config.cmd') --unattended --url "https://github.com/$Repo" --token $token --name $name --labels 'tcg-pc' --work '_work' --replace | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "config.cmd falló para $name" }
  # The jobs run with `shell: bash`: Git's bash first (WindowsApps\bash.exe is WSL's launcher).
  $pathFile = Join-Path $dir '.path'
  $current = if (Test-Path $pathFile) { (Get-Content $pathFile -Raw).Trim() } else { $env:PATH }
  if (-not $current.StartsWith($GitBin)) { Set-Content -Path $pathFile -Value "$GitBin;$current" -NoNewline -Encoding ascii }
  Write-Host "Registrado $name"
}

# Started hidden at logon (and now, through WMI: a process started from a Claude session dies with the app, H-016).
$lines = @('Set shell = CreateObject("WScript.Shell")')
foreach ($n in 1..$Count) {
  $run = Join-Path (Join-Path $Base "tcg-pc-$n") 'run.cmd'
  $lines += "shell.Run """"""$run"""""", 0, False"
}
Set-Content -Path $Startup -Value ($lines -join "`r`n") -Encoding ascii
$started = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "wscript.exe `"$Startup`"" }
Write-Host "Runners arrancados (WMI: $($started.ReturnValue)); arrancan solos al iniciar sesión ($Startup)."

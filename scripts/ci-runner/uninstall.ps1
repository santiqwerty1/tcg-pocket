# Saca los runners propios de la PC (D-023): antes de pasar el repo a público, o cuando vuelvan los minutos de
# Actions. Los da de baja en GitHub, los frena, borra el .vbs de Inicio y la carpeta. Después, el Coordinador borra
# las variables CI_RUNNER y CI_RUNNER_WINDOWS del repo para que la CI vuelva a los runners de GitHub.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1
$ErrorActionPreference = 'Stop'
$Repo = 'santiqwerty1/tcg-pocket'
$Base = Join-Path $env:USERPROFILE 'actions-runner'
$Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\tcg-pocket-ci-runners.vbs'

if (Test-Path $Startup) { Remove-Item $Startup -Force }
Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe' OR Name='Runner.Worker.exe'" |
  Where-Object { $_.ExecutablePath -like "$Base*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
$token = gh api -X POST "repos/$Repo/actions/runners/remove-token" --jq .token
foreach ($dir in Get-ChildItem $Base -Directory -Filter 'tcg-pc-*') {
  & (Join-Path $dir.FullName 'config.cmd') remove --token $token | Out-Null
  Write-Host "Dado de baja $($dir.Name)"
}
Remove-Item $Base -Recurse -Force
Write-Host 'Runners sacados. Falta borrar las variables del repo: gh variable delete CI_RUNNER; gh variable delete CI_RUNNER_WINDOWS'

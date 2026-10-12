# Saca los runners propios de la PC (D-023). Los da de baja en GitHub, los frena, borra el .vbs de Inicio y la
# carpeta. Desde el 11/10/2026 el repo es público y la CI corre en los runners de GitHub: los propios no se usan ahí.
#
# Si el repo se renombró (el 11/10/2026 el privado pasó a santiqwerty1/tcg-pocket-historial y su nombre lo tomó el
# público), `config.cmd remove` falla con NotFound: los runners quedaron registrados en el repo renombrado y su
# `.runner` apunta a la URL vieja. Conviene darlos de baja por la API (`gh api repos/<repo>/actions/runners` da el id;
# después `gh api -X DELETE repos/<repo>/actions/runners/<id>`) y correr igual este script, que borra la carpeta y el
# lanzador de Inicio aunque la baja falle.
#
#   powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1 [-Prefix tcg-pc] [-Repo santiqwerty1/tcg-pocket]
param([string]$Prefix = 'tcg-pc', [string]$Repo = 'santiqwerty1/tcg-pocket')
$ErrorActionPreference = 'Stop'
$Base = Join-Path $env:USERPROFILE 'actions-runner'
$Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\tcg-pocket-ci-runners.vbs'

if (Test-Path $Startup) { Remove-Item $Startup -Force }
Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe' OR Name='Runner.Worker.exe'" |
  Where-Object { $_.ExecutablePath -like "$Base*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
$token = gh api -X POST "repos/$Repo/actions/runners/remove-token" --jq .token
foreach ($dir in Get-ChildItem $Base -Directory -Filter "$Prefix-*") {
  & (Join-Path $dir.FullName 'config.cmd') remove --token $token | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "config.cmd no pudo dar de baja $($dir.Name) en $Repo (¿repo renombrado?). Por la API: gh api repos/<repo>/actions/runners y gh api -X DELETE repos/<repo>/actions/runners/<id>"
  } else {
    Write-Host "Dado de baja $($dir.Name)"
  }
}
Remove-Item $Base -Recurse -Force
Write-Host 'Runners sacados. Si el repo tenía las variables CI_RUNNER, CI_RUNNER_LIGHT o CI_RUNNER_WINDOWS, borrarlas (gh variable delete <nombre>) para que la CI use los runners de GitHub.'

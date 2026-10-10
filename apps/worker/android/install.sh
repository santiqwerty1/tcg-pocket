#!/data/data/com.termux/files/usr/bin/bash
# This file is public. Credentials are read only from the tty/config and sent in curl's stdin.
set +x
set -euo pipefail
umask 077
[[ $(uname -m) == aarch64 ]] || { echo 'Este paquete requiere Android aarch64 (arm64).'; exit 1; }
command -v pkg >/dev/null || { echo 'Abrí este instalador dentro de Termux.'; exit 1; }
command -v node >/dev/null || pkg install -y nodejs-lts
command -v curl >/dev/null || pkg install -y curl
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 24 ]] || { echo 'Actualizá Node: pkg install nodejs-lts'; exit 1; }
server=${1:-https://tcg-pocket.fly.dev}
server=${server%/}
[[ $server =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || { echo 'El servidor debe ser un origen HTTPS, sin rutas ni credenciales.'; exit 1; }
root=${TCG_ANDROID_HOME:-$HOME/.local/share/tcg-worker-android}
data=$root/data
mkdir -p "$root/releases" "$data"
chmod 700 "$root" "$data"
work=$(mktemp -d "$root/install.XXXXXX")
trap 'unset token; rm -rf -- "$work"' EXIT
token=''
if [[ -f $data/config.json ]]; then
  token=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1])); process.stdout.write(c.token || "")' "$data/config.json")
fi
printf 'Token de worker (se oculta; Enter conserva el guardado): ' >/dev/tty
IFS= read -r -s answer </dev/tty
printf '\n' >/dev/tty
token=${answer:-$token}
unset answer
[[ $token =~ ^tcg_wk_[a-zA-Z0-9_-]+$ ]] || { echo 'Necesitás un token de tipo worker (tcg_wk_…).'; exit 1; }
printf 'header = "Authorization: Bearer %s"\n' "$token" |
  curl --config - --fail --silent --show-error --proto '=https' --max-time 300 \
    --dump-header "$work/headers" --output "$work/package.tar.gz" "$server/api/worker/packages/android-arm64"
sha=$(awk 'tolower($1)=="x-checksum-sha256:" {gsub("\r", "", $2); print $2}' "$work/headers")
[[ $sha =~ ^[a-f0-9]{64}$ ]] || { echo 'La descarga no trae una suma SHA256 válida.'; exit 1; }
printf '%s  %s\n' "$sha" "$work/package.tar.gz" | sha256sum --check --status || { echo 'La suma no coincide; no instalo.'; exit 1; }
tar -xzf "$work/package.tar.gz" -C "$work"
chmod 700 "$work/tcg-worker/engine-cli"
# Verify offline before replacing a working install or storing a new token.
node "$work/tcg-worker/worker.mjs" --check-engine
cores=$(node -p 'Math.max(1, Math.floor(require("os").availableParallelism()/2))')
printf 'Núcleos (Enter = la mitad, %s): ' "$cores" >/dev/tty
IFS= read -r answer </dev/tty
cores=${answer:-$cores}
[[ $cores =~ ^[1-9][0-9]*$ ]] || { echo 'Núcleos: usá un entero positivo.'; exit 1; }
printf '¿Solo mientras carga? [s/N]: ' >/dev/tty
IFS= read -r charging </dev/tty
if [[ $charging == [sS] ]]; then
  echo 'Instalá Termux:API del mismo origen que Termux, y concedé los permisos cuando los pida.'
  command -v termux-battery-status >/dev/null || pkg install -y termux-api
  timeout 20s termux-battery-status > "$work/battery.json" || { echo 'Termux:API no respondió. Instalá la app, abrila y revisá sus permisos.'; exit 1; }
  node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1])); if(typeof b.plugged!=="string") process.exit(1)' "$work/battery.json"
fi
# Stop both supervisor and child, allowing SIGTERM to release leases before the update.
node - "$data" "$root/current/worker.mjs" <<'NODE'
const fs = require('fs'), path = require('path')
const dir = process.argv[2]
for (const file of ['android/worker.lock', 'worker.lock']) {
  const lock = path.join(dir, file)
  try {
    const pid = Number(fs.readFileSync(lock, 'utf8'))
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Lock inválido; no detengo ningún proceso.')
    let command
    try { command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0') }
    catch (e) { if (e.code === 'ENOENT') { fs.unlinkSync(lock); continue } throw e }
    if (!command.includes(process.argv[3])) throw new Error('El PID del lock corresponde a otro proceso; revisá el lock antes de actualizar.')
    process.kill(pid, 'SIGTERM')
  } catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e }
}
NODE
for ((n=0; n<35; n++)); do
  [[ ! -f $data/worker.lock && ! -f $data/android/worker.lock ]] && break
  sleep 1
done
[[ ! -f $data/worker.lock && ! -f $data/android/worker.lock ]] || { echo 'El worker no se detuvo. No actualizo mientras corre.'; exit 1; }
release=$root/releases/$sha
if [[ ! -d $release ]]; then mv -- "$work/tcg-worker" "$release"; fi
node - "$root/current/determinism.json" "$release/determinism.json" "$data/state.json" <<'NODE'
const fs = require('fs')
const [before,after,state]=process.argv.slice(2)
if (fs.existsSync(before) && fs.existsSync(state)) {
  const old=JSON.parse(fs.readFileSync(before)).version, next=JSON.parse(fs.readFileSync(after)).version
  if (old.engineRev!==next.engineRev || old.cliVersion!==next.cliVersion) {
    fs.renameSync(state,state+'.motor-anterior-'+Date.now())
    console.log('Cambió el motor: aparté los resultados pendientes anteriores; se vuelven a jugar en la cola.')
  }
}
NODE
ln -sfn "$release" "$root/current"
printf '%s' "$token" | node -e '
const fs=require("fs"), os=require("os"), path=require("path")
const [dir,server,cores,charging,engine]=process.argv.slice(1)
let token=""; process.stdin.setEncoding("utf8").on("data",d=>token+=d).on("end",()=>{
  const config={server,token,cores:Number(cores),name:"Android "+os.hostname(),enginePath:engine,onlyCharging:/^s$/i.test(charging)}
  const file=path.join(dir,"config.json")
  fs.writeFileSync(file,JSON.stringify(config,null,2)+"\n",{mode:0o600}); fs.chmodSync(file,0o600)
})' "$data" "$server" "$cores" "$charging" "$root/current/engine-cli"
unset token
mkdir -p "$PREFIX/bin"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'export TCG_WORKER_DIR=%q\n' "$data"
  printf 'exec node %q "$@"\n' "$root/current/worker.mjs"
} > "$PREFIX/bin/tcg-worker"
chmod 700 "$PREFIX/bin/tcg-worker"
tcg-worker --check
printf '¿Arrancar al encender el celu con Termux:Boot? [s/N]: ' >/dev/tty
IFS= read -r boot </dev/tty
bootDir=${TCG_ANDROID_BOOT_DIR:-$HOME/.termux/boot}
bootFile=$bootDir/tcg-worker
if [[ $boot == [sS] ]]; then
  echo 'Instalá Termux:Boot del mismo origen y abrilo una vez.'
  mkdir -p "$bootDir"
  printf '#!%s/bin/bash\nexec %q >> %q 2>&1\n' "$PREFIX" "$PREFIX/bin/tcg-worker" "$data/boot.log" > "$bootFile"
  chmod 700 "$bootFile"
else
  rm -f -- "$bootFile"
fi
echo "Listo. Arrancá con tcg-worker; Ctrl+C lo detiene. Config y logs: $data."
echo 'Para actualizar, volvé a correr este instalador. Leé el LEEME.txt para batería y Android 12+.'

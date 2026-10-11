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
name=Android
autoUpdate=''
if [[ -f $data/config.json ]]; then
  token=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1])); process.stdout.write(c.token || "")' "$data/config.json")
  name=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1])); process.stdout.write(typeof c.name === "string" && c.name.trim() && c.name !== "Android localhost" ? c.name : "Android")' "$data/config.json")
  # D-026: a phone where updates were turned off keeps them off after a reinstall.
  autoUpdate=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1])); process.stdout.write(c.autoUpdate === false ? "false" : "")' "$data/config.json")
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
printf 'Núcleos (prioridad baja deja CPU a otras tareas; por el calor, Enter = la mitad, %s): ' "$cores" >/dev/tty
IFS= read -r answer </dev/tty
cores=${answer:-$cores}
[[ $cores =~ ^[1-9][0-9]*$ ]] || { echo 'Núcleos: usá un entero positivo.'; exit 1; }
printf 'Nombre en la app (Enter = %s): ' "$name" >/dev/tty
IFS= read -r answer </dev/tty
name=${answer:-$name}
printf '¿Tomar también bots lentos (MCTS, profundidad 3 o más)? [s/N]: ' >/dev/tty
IFS= read -r slowBots </dev/tty
printf '¿Solo mientras carga? [s/N]: ' >/dev/tty
IFS= read -r charging </dev/tty
if [[ $charging == [sS] ]]; then
  echo 'Instalá Termux:API del mismo origen que Termux, y concedé los permisos cuando los pida.'
  command -v termux-battery-status >/dev/null || pkg install -y termux-api
  timeout 20s termux-battery-status > "$work/battery.json" || { echo 'Termux:API no respondió. Instalá la app, abrila y revisá sus permisos.'; exit 1; }
  node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1])); if(typeof b.plugged!=="string") process.exit(1)' "$work/battery.json"
fi
# Share the launcher's graceful stop, even when upgrading an older installation without --stop.
TCG_WORKER_DIR="$data" TCG_ANDROID_WORKER_ENTRY="$root/current/worker.mjs" \
  node "$work/tcg-worker/worker.mjs" --stop
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
previous=''
if [[ -L $root/current ]]; then previous=$(basename -- "$(readlink -- "$root/current")"); fi
ln -sfn "$release" "$root/current"
# D-026: the pointer the worker's updates and rollbacks read says the same as the link (and keeps the way back).
node -e '
const fs=require("fs"), path=require("path")
const [releases,sha,previous]=process.argv.slice(1)
const pointer={sha,previous:/^[0-9a-f]{64}$/.test(previous)&&previous!==sha?previous:null}
const file=path.join(releases,"current.json"), temporary=file+".tmp"
fs.writeFileSync(temporary,JSON.stringify(pointer,null,2)+"\n"); fs.renameSync(temporary,file)
' "$root/releases" "$sha" "$previous"
printf '%s' "$token" | node -e '
const fs=require("fs"), path=require("path")
const [dir,server,cores,charging,engine,name,slowBots,autoUpdate]=process.argv.slice(1)
let token=""; process.stdin.setEncoding("utf8").on("data",d=>token+=d).on("end",()=>{
  const config={server,token,cores:Number(cores),priority:"below_normal",name,enginePath:engine,onlyCharging:/^s$/i.test(charging),allowSlowBots:/^s$/i.test(slowBots),...(autoUpdate==="false"?{autoUpdate:false}:{})}
  const file=path.join(dir,"config.json")
  fs.writeFileSync(file,JSON.stringify(config,null,2)+"\n",{mode:0o600}); fs.chmodSync(file,0o600)
})' "$data" "$server" "$cores" "$charging" "$root/current/engine-cli" "$name" "$slowBots" "$autoUpdate"
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
printf '¿Accesos directos para Termux:Widget? [s/N]: ' >/dev/tty
IFS= read -r widget </dev/tty
shortcuts=$HOME/.shortcuts
startFile=$shortcuts/'Arrancar worker'
stopFile=$shortcuts/tasks/'Detener worker'
statusFile=$shortcuts/'Estado del worker'
if [[ $widget == [sS] ]]; then
  echo 'Instalá Termux:Widget del mismo origen. Agregá su widget a la pantalla de inicio y tocá refrescar.'
  mkdir -p "$shortcuts/tasks"
  chmod 700 "$shortcuts" "$shortcuts/tasks"
  printf '#!%s/bin/bash\nexec %q\n' "$PREFIX" "$PREFIX/bin/tcg-worker" > "$startFile"
  {
    printf '#!%s/bin/bash\n' "$PREFIX"
    printf 'message=$(%q --stop 2>&1)\nresult=$?\nprintf "%%s\\n" "$message"\n' "$PREFIX/bin/tcg-worker"
    printf 'if [[ -x %q ]]; then timeout 10s %q "$message" || true; fi\nexit "$result"\n' "$PREFIX/bin/termux-toast" "$PREFIX/bin/termux-toast"
  } > "$stopFile"
  printf '#!%s/bin/bash\n%q --check\nresult=$?\nread -r -p "Enter para cerrar…"\nexit "$result"\n' "$PREFIX" "$PREFIX/bin/tcg-worker" > "$statusFile"
  chmod 700 "$startFile" "$stopFile" "$statusFile"
else
  rm -f -- "$startFile" "$stopFile" "$statusFile"
fi
echo "Listo. Arrancá con tcg-worker; Ctrl+C lo detiene. Config y logs: $data."
echo 'Se actualiza solo con cada versión nueva de la app. Leé el LEEME.txt para batería y Android 12+.'

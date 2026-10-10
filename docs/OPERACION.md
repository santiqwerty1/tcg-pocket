# Operación

Cómo se sabe si la app anda, qué corre sola y qué hacer cuando algo falla (Fase 38, R-011, R-008).

## Qué corre sola

| Tarea | Cuándo | Si falla |
|---|---|---|
| Copia diaria (`backup_blobs`) | 04:00 de Buenos Aires (`BACKUP_CRON`, en producción) | Aviso `backup_stale`: «Falló la copia diaria del …» o «No hay copia diaria desde …» (más de 26 h) |
| Copia fuera de Supabase (bucket de Tigris, Fase 39) | Después de la copia diaria; a mano con `POST /api/backup/offsite` | Aviso `backup_offsite`: la subida falló o no hubo una buena en 26 h |
| Limpieza (repeticiones viejas, crudos de standings, Fase 39) | 04:20, solo con `RETENTION_CRON=true`; vista previa con `node /app/apps/api/dist/cli/retention.js` o `POST /api/ops/retention` (`--apply`/`?apply=1` borra) | En el log; el resultado en `/api/ops/status` (`retention`) |
| Comprobación de la copia en la nube (Fase 39) | El 1 de cada mes, con la prueba de restauración | Aviso `backup_offsite`: «Falló la comprobación de la copia en la nube» |
| Prueba de restauración | El 1 de cada mes a las 04:30 | Aviso `backup_drill` |
| Sincronización de Limitless | Al arrancar y cada 6 h (`LIMITLESS_SYNC`, en producción) | Aviso `limitless_sync`: la última corrida falló, o ninguna buena en 13 h |
| Actualización del catálogo | A mano (Más → Catálogo) | Aviso `catalog_sync` si la última falló (sigue el catálogo anterior) |
| Chequeos de GitHub (set nuevo del tracker, commits nuevos de deckgym) | Cada 12 h (cada hora después de una falla) | Aviso `github_check` (info) |
| Workers | Cuando hay trabajo | Aviso `worker_idle`: hay trabajo y ningún worker en 30 min |
| Tamaño de la base | — | Aviso `database_size` desde 350 MB (el plan gratis de Supabase llega a 500) |

Los avisos se ven en Más → Avisos y llegan al celu como notificación (`NotificationsWatcher`, cada 15 s), una vez por título. Cada título lleva la fecha, así que una falla nueva vuelve a avisar.

## Estado del servidor

`GET /api/ops/status` (con sesión) y la tool `system_status` (Claude) devuelven lo mismo:
- la versión desplegada (el sha del commit);
- la memoria (`rss`, el heap y su techo);
- el tamaño de la base;
- la última copia;
- la última corrida de Limitless;
- el catálogo;
- los chequeos de GitHub;
- los workers en línea;
- la cola.

## Chequeo externo: UptimeRobot (P-011)

Los avisos los manda el mismo servidor: si se cae, o si Supabase se pausa, no avisa nadie. UptimeRobot mira la app desde afuera.

1. Crear una cuenta gratis en <https://uptimerobot.com>.
2. **Add New Monitor**:
   - **Monitor Type:** Keyword (HTTP(s) – Keyword).
   - **Friendly Name:** TCG Pocket.
   - **URL:** `https://tcg-pocket.fly.dev/healthz`.
   - **Keyword:** `"ok":true`, con **Alert When: Keyword Not Exists**.
     - `/healthz` responde `{"ok":true,…}` solo si el servidor anda y la base contesta en 3 s; si no, da 503 sin esa palabra.
   - **Monitoring Interval:** 5 minutos, el mínimo del plan gratis.
3. **Alert Contacts:**
   - el mail de la cuenta viene incluido;
   - para el celu, instalar la app de UptimeRobot e iniciar sesión: los avisos llegan como notificación.
4. Opcional: una **Status Page** pública, si querés ver el historial sin entrar a la cuenta.

Con esto, una caída se avisa dentro de los 5 minutos, y la vuelta también.

## Copia fuera de Supabase y reconstrucción

La guía para levantar todo desde cero (base nueva, app nueva, restaurar la copia del bucket) está en `docs/RECONSTRUIR.md`.

## Secretos opcionales

- `GITHUB_TOKEN`: los chequeos de GitHub salen sin token desde las IP compartidas de Fly, con un límite de 60 pedidos por hora por IP. Con un token, el límite es de 5.000 por hora.
  - Alcanza un token *fine-grained* con «Public repositories (read-only)» y ningún permiso más.
  - Se carga con `flyctl secrets set GITHUB_TOKEN=… --app tcg-pocket`, sin pasar por el chat.

## Memoria (R-008)

- **La máquina:** 512 MB, con 512 MB de swap (`swap_size_mb` en `fly.toml`), así que un pico la pone lenta en vez de matar el proceso.
- **El heap de V8:** tiene un techo de 320 MB (`NODE_OPTIONS=--max-old-space-size=320`).
- **Los datasets de torneos:**
  - se arman de a uno: dos pedidos de la misma era comparten el armado;
  - después de cada armado, el log deja la memoria (`tournament dataset built`, con `rssMb` y `heapUsedMb`);
  - vencen una vez por corrida de Limitless, no después de cada torneo.
- **Las situaciones para resolver:** guardan en memoria las de 64 partidas como máximo (la lista lee 60).

Para mirar la memoria sin entrar a la app: `system_status`, o `GET /api/ops/status` con sesión.

## CI en la PC (D-023)

Mientras el repo sea privado y sin minutos de Actions, la CI corre en dos runners propios de la PC: `tcg-pc-1` y `tcg-pc-2`, con la etiqueta `tcg-pc`.
- **Dónde están:** en `%USERPROFILE%\actions-runner`.
- **Arranque:** al iniciar sesión, por `tcg-pocket-ci-runners.vbs` en Inicio.
- **Instalar:** `powershell -ExecutionPolicy Bypass -File scripts\ci-runner\install.ps1`.
- **Otra PC** (por ejemplo la del Ryzen): clonar el repo y correr el mismo script con otro prefijo, `install.ps1 -Prefix tcg-ryzen`. Con el mismo nombre, `config.cmd --replace` se llevaría los runners de la primera PC. El script revisa antes Git, gh con sesión, Docker Desktop, Rust (GNU) y WinLibs, y dice con qué `winget` instalar lo que falte. La etiqueta sigue siendo `tcg-pc`, así que la CI usa los runners de las dos PC. Si esa PC también corre el worker, el worker 0.2.8 usa prioridad baja para los motores de fondo: la CI mantiene prioridad normal y recibe CPU primero (D-023). El asistente sugiere todos los hilos disponibles; se puede conservar otro presupuesto.
- **Cómo elige runner la CI:** con las variables del repo `CI_RUNNER` y `CI_RUNNER_WINDOWS` (`tcg-pc`). Sin ellas, vuelve a los de GitHub.
- **Base y puerto por runner:** `tcg_ci_test_<runner>` y `tcg_ci_screens_<runner>`, en el Postgres de `docker compose`, y un puerto propio para las pantallas. No pisan los de las sesiones.
- **El motor:** se compila con el Rust y el WinLibs de la PC, en `%USERPROFILE%\actions-runner\tcg-pc-<n>\_work\tcg-pocket\cargo-target`.
- **Ver si andan:** `gh api repos/santiqwerty1/tcg-pocket/actions/runners` (`online`).
  - Si están caídos: `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "wscript.exe `"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\tcg-pocket-ci-runners.vbs`"" }`.
  - Nunca `Start-Process` desde una sesión de Claude (H-016).
- **Seguridad:** solo corren código de este repo privado. Los PR de Dependabot no corren en la PC, y Dependabot queda en pausa hasta la mudanza.
- **Sacarlos (antes de pasar el repo a público):**
  1. `powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1`.
  2. `gh variable delete CI_RUNNER` y `gh variable delete CI_RUNNER_WINDOWS`.
  3. `open-pull-requests-limit` de Dependabot a 2 y 1.

## Deploy

`pnpm deploy:fly` (`scripts/deploy.mjs`) hace todo esto:
1. Revisa que el árbol esté limpio, que el commit esté en `origin/main`, que su CI esté en verde y que pase `posta check`.
2. Corre `flyctl deploy --ha=false` con `APP_VERSION` igual al sha.
3. Las migraciones corren en una máquina aparte, antes de reemplazar la que anda (`release_command`): si fallan, el deploy se corta y la app sigue como estaba. Al arrancar el contenedor se corren otra vez, y para entonces no hacen nada.
4. Espera hasta 3 minutos a que `/healthz` responda con la versión nueva. Si no responde, falla.

**Las migraciones tienen que ser compatibles hacia atrás.** Con `release_command`, la versión anterior sigue andando unos minutos con el esquema nuevo, mientras arranca la nueva. Por eso:
- columnas nuevas con valor por defecto o que acepten nulos;
- nada de borrar ni renombrar en el mismo deploy que el código que deja de usarlo: primero el código y después, en otro deploy, la migración que borra.

### Una migración que falló

- **Si falla en el `release_command`:** el deploy se corta y la versión anterior sigue andando. Prisma deja la migración marcada como fallida en `_prisma_migrations`.
- **El contenedor no se cae por eso:** si `migrate deploy` falla al arrancar (P3009), lo deja en el log y arranca igual.
- **Para destrabarla:**
  1. Arreglar la migración en un commit nuevo.
  2. Marcarla como deshecha: `flyctl machine exec <id> --app tcg-pocket "sh -c 'cd /app/apps/api && node node_modules/prisma/build/index.js migrate resolve --rolled-back <nombre_de_la_migración>'"`.
     - Si en realidad se aplicó a mano, va `--applied` en vez de `--rolled-back`.
  3. Desplegar de nuevo.

La CI saltea el motor de Windows cuando no cambió y arma la imagen de Docker solo en main (DECISIONES 41.1–41.3). Dependabot abre como mucho un PR agrupado por mes para npm y otro para las Actions; el motor queda afuera porque deckgym está fijo (D-013).

## Prioridad del worker 0.2.8 (D-023, T-015)

En `config.json`, `"priority": "below_normal"` es el valor por defecto. `TCG_WORKER_PRIORITY` manda sobre el archivo; los otros valores admitidos son `normal` e `idle`. `--check` muestra `priority`. El cambio toma efecto en el siguiente arranque del worker; lo opera el Coordinador.

Cada motor de simulación, lote, consistencia u optimización (incluido explorar) recibe la prioridad inmediatamente después de crearse. Las partidas en vivo contra el bot y las pistas del entrenador piden normal; las situaciones se resuelven desde repeticiones. El proceso del worker conserva la suya para atender latidos y red. Si el sistema rechaza el cambio (por ejemplo permisos en Android), queda un aviso con PID y prioridad en `worker.log` y el trabajo continúa con la prioridad heredada.

[Node documenta las constantes portables](https://nodejs.org/api/os.html#priority-constants): `below_normal` es Below Normal en Windows / nice 10 en Linux y Android; `idle` es Idle / nice 19; normal es Normal / nice 0. La prioridad reparte CPU; no reserva núcleos ni memoria, ni elimina el calor. `engine-cli` conserva la exclusión de EcoQoS (H-001) y su versión 0.3.3.

Medición y comandos para repetirla: [prioridad del worker](WORKER-PRIORIDAD.md).

## Worker en Android arm64 (T-015)

En Más → Tokens de API → «Worker en Android» están los pasos y un comando sin token. Instalá Termux desde [F-Droid](https://f-droid.org/packages/com.termux/) o [GitHub oficial](https://github.com/termux/termux-app#installation), fuera de Play Store. Termux:API y Termux:Boot deben venir del mismo origen que Termux: sus firmas no se pueden mezclar. Creá un token de tipo worker para el celu y pegalo cuando el instalador lo pide oculto dentro de Termux.

El comando baja `/api/worker/install/android.sh` por HTTPS, sin autenticación porque no contiene datos. El script descarga `/api/worker/packages/android-arm64` con Bearer por stdin, verifica `X-Checksum-Sha256` y no sigue redirecciones. Guarda la config en `~/.local/share/tcg-worker-android/data/config.json` (600), conserva la identidad y crea `$PREFIX/bin/tcg-worker`. Node se instala con `pkg install nodejs-lts`: el [paquete oficial consultado el 10/10/2026](https://github.com/termux/termux-packages/blob/master/packages/nodejs-lts/build.sh) es 24.18.0; el JS requiere >=24.

- `tcg-worker`: pide wake-lock y trabaja hasta Ctrl+C/SIGTERM; lo libera al terminar.
- `tcg-worker --check`: determinismo, versión exacta del motor de la imagen, configuración y conexión, sin tomar trabajo.
- Solo mientras carga: requiere Termux:API, `pkg install termux-api` y los permisos que solicite. Cada 15 s revisa si está enchufado (también batería llena); una lectura fallida pausa. Desenchufar corta el motor y devuelve leases sin contar fallas; enchufar inicia otro proceso que reanuda resultados.
- Inicio automático: elegirlo en el instalador, instalar Termux:Boot y abrirlo una vez. Escribe solo `~/.termux/boot/tcg-worker`; su log queda en `data/boot.log`.
- Actualizar: repetir el comando. Primero prueba el motor nuevo, después detiene el viejo por SIGTERM y cambia motor/JS juntos. Conserva el id; si cambió el motor, aparta `state.json` con sufijo `.motor-anterior-...` y los pendientes se vuelven a jugar. No mezclar archivos de paquetes distintos.

Por defecto usa la mitad de los núcleos y respeta ese tope aun si el trabajo pide más. Simular consume batería y calienta, incluso enchufado: empezá con pocos núcleos, dejá ventilación y frenalo si calienta demasiado. El supervisor conserva wake-lock al esperar el cargador; esto también consume energía. En Android → Apps → Termux → Batería, elegí «Sin restricciones» o excluí la optimización; aplicalo también a Termux:API y habilitá el inicio automático del fabricante si existe. El wake-lock no impide cierres por memoria o por políticas del fabricante. SIGKILL no permite cleanup; sin red al apagar, los leases vencen en 3 minutos.

### Restricciones de procesos de Android 12+

[Guía mantenida por un desarrollador de Termux](https://github.com/agnostic-apollo/Android-Docs/blob/master/en/docs/apps/processes/phantom-cached-and-empty-processes.md), consultada el 10/10/2026. Los nombres de las opciones varían por fabricante:

- Android 14+: Opciones de desarrollador → «Disable child process restrictions» / «Desactivar restricciones de procesos secundarios». Mantené las opciones de desarrollador activadas; al desactivarlas se revierte este toggle.
- Android 12L/13 y superiores: desde una PC con adb autorizado, `adb shell settings put global settings_enable_monitor_phantom_procs false`. Verificar: `adb shell settings get global settings_enable_monitor_phantom_procs`. Deshacer: `adb shell settings delete global settings_enable_monitor_phantom_procs`.
- Android 12 original: no ofrece un ajuste para impedir la matanza por CPU excesiva. Para ampliar el límite de procesos: `adb shell device_config set_sync_disabled_for_tests persistent` y `adb shell device_config put activity_manager max_phantom_processes 2147483647`. Deshacer: `adb shell device_config delete activity_manager max_phantom_processes` y `adb shell device_config set_sync_disabled_for_tests none`. La guía describe las limitaciones de Google Play Services y cada fabricante.

Son cambios globales del dispositivo. El instalador no los ejecuta. El LEEME del paquete lleva los mismos pasos.

### Construir y verificar sin el teléfono

`pnpm -F @tcg/worker package:android` requiere Docker y arma `apps/worker/build/tcg-worker-0.2.8-android-arm64.tar.gz`; la versión sale de `WORKER_VERSION`. Fly lo construye dentro de su imagen con el target `android-package` y Cargo con locks y cachés de BuildKit. En runtime solo se copian el tar, el instalador y el manifiesto de versión: no Rust, Zig ni qemu. No hay que subir un artefacto separado ni guardar credenciales de GitHub en el servidor.

Con Linux/WSL y qemu-user, extraé el tar en una carpeta temporal y corré `node apps/worker/scripts/check-arm.mjs <carpeta>/tcg-worker`. Repite la referencia con 1 y 2 hilos. La CI ejecuta esto y la prueba SIGTERM con servidor/motor de mentira. La prueba local ARM coincidió con Windows: 24 partidas con r/e2/f2, semilla 20261010, 1 y 2 hilos; comparar totales y cada partida, excluyendo tiempos/rutas. Falta el teléfono real: musl ejecutable, permisos API, calor, suspensión y Boot se verifican ahí con `--check` y una simulación chica.

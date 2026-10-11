# @tcg/worker

Worker de simulación para la PC de Santi (BRIEF §4, PLAN §3.7, Fase 6). Pide trabajo a la app por HTTPS (solo conexiones salientes), juega cada chunk con `engine-cli` (deckgym-core, `engine/`) y sube victorias, derrotas, empates, turnos y la muestra de repeticiones. Contrato: `docs/API.md` «Simulación» → «Worker». Decisiones: `docs/DECISIONES.md` 6.1–6.15.

## Cómo funciona

1. **Reclamar**: `POST /api/worker/claim` con long-poll de 25 s; la app entrega un chunk del trabajo al que le quedan menos (a igualdad, el más viejo; `FOR UPDATE SKIP LOCKED`) con un lease de 3 minutos. Si la cola espera otro motor, contesta `requiredEngineRev` y el worker lo avisa en el log.
2. **Jugar**: escribe el trabajo en `work/<carpeta>/job.json` y corre `engine-cli simulate|optimize job.json result.json` con los núcleos configurados; lee el progreso de stderr.
3. **Latido** cada 30 s con las partidas jugadas, un pedido a la vez y hasta 20 s por intento. Un corte de red deja el motor corriendo; al volver, un lease vencido se renueva si nadie tomó el chunk. Si el servidor informa cancelación o pérdida, corta el motor. En un lote, corta el proceso compartido, revalida los chunks restantes y los juega por separado; una falla de red interrumpe ese ciclo de latidos hasta el próximo intervalo.
4. **Resultado**: lo guarda primero en `state.json` y después lo sube (idempotente), con las repeticiones en gzip. Si no hay red, reintenta (1 s, 2 s, 4 s… hasta 5 min); si se apaga la PC antes de subir, lo manda al volver.
5. **Si se corta** a mitad de un chunk (PC apagada, proceso muerto), el lease vence y la app lo vuelve a encolar: se juega de nuevo con la misma semilla y da el mismo resultado.

Un error inesperado reinicia el bucle al minuto; un token rechazado (401/403) lo detiene. Corre un solo worker por carpeta (`worker.lock` con el PID): un segundo arranque avisa en el log y termina. `engine-cli` se excluye del «modo eficiencia» de Windows al arrancar: oculto, Windows lo dejaba en los núcleos de eficiencia (H-001 en la bóveda).

Worker 0.2.11 registra código y señal de cada motor. Una salida 0 sin `result.json` válido se informa como falla del chunk y el worker continúa. La limpieza de arranque conserva directorios en uso y resultados pendientes. Los long-polls de partidas en vivo reintentan timeouts, cortes y 5xx silenciosamente (1 s, 2 s, 4 s… hasta 30 s), incluida la consulta de versión de Android, sin reiniciar la simulación. Un cambio real del motor sigue rechazando nuevos reclamos.

El motor no guarda checkpoints: si otro worker toma un lease vencido, las partidas parciales se pierden. La causa histórica del ENOENT del S25 aún no está confirmada: el código de 0.2.9 limpia `work/` antes de arrancar los bucles, trata una salida por señal como error y Rust propaga los errores al escribir. Los logs nuevos también indican si el directorio y el resultado existen y conservan las últimas salidas del motor para distinguir un incumplimiento del contrato de una eliminación externa.

## Configuración

`%LOCALAPPDATA%\tcg-worker\config.json` (o variables de entorno, que mandan):

| Clave | Variable | Por defecto | Uso |
|---|---|---|---|
| `token` | `TCG_WORKER_TOKEN` | — (obligatorio) | Token `tcg_wk_…` de tipo worker (Más → Tokens de API). Solo viaja como `Authorization` a la app. |
| `server` | `TCG_SERVER` | `https://tcg-pocket.fly.dev` | URL de la app. |
| `cores` | `TCG_WORKER_CORES` | Todos los hilos disponibles (Android: la mitad) | Hilos por chunk. |
| `priority` | `TCG_WORKER_PRIORITY` | `below_normal` | Prioridad de los motores de fondo: `below_normal`, `normal` o `idle`. |
| `name` | `TCG_WORKER_NAME` | nombre de la PC | Cómo aparece en Más → Simulación. |
| `enginePath` | `TCG_ENGINE_PATH` | `engine/target/release/engine-cli.exe` del repo | Otro binario (por ejemplo el artefacto `engine-cli-windows` de CI). |
| — | `TCG_WORKER_DIR` | `%LOCALAPPDATA%\tcg-worker` | Carpeta de `config.json`, `worker-id`, `state.json`, `work/` y `worker.log`. |

Worker 0.2.8: el motor de simulación, lotes, consistencia y explorar se lanza con prioridad baja para dejar CPU a la CI. `normal` desactiva esa preferencia; `idle` cede más. Las partidas contra el bot y sus pistas del entrenador siguen en normal, incluso con `priority: "idle"`. El proceso del worker conserva su prioridad para sostener los latidos. `--check` muestra la opción; si el sistema rechaza el cambio de prioridad se registra y el trabajo sigue con la heredada. La exclusión de EcoQoS del motor no cambia (H-001).

## Uso

```bash
pnpm -F @tcg/worker build
node apps/worker/dist/main.js --check   # configuración, motor y si llega al servidor
node apps/worker/dist/main.js --once    # un chunk y termina
node apps/worker/dist/main.js           # hasta Ctrl+C
pnpm -F @tcg/worker install-task        # arranca oculto al iniciar sesión (tarea programada o, sin admin, carpeta Inicio) y ya mismo
pnpm -F @tcg/worker uninstall-task
```

Worker 0.2.2 (Fase 20): las partidas con modo entrenador necesitan un motor compilado con `engine/src/coach.rs`; un motor anterior hace fallar la partida con «recompilá el motor».

El motor: `cargo build --release` en `engine/` (Rust estable y WinLibs en el `PATH`, ver CLAUDE.md) o `pnpm -F @tcg/worker engine:build`.

## Otra PC: el paquete portable

Para que otra PC juegue chunks (la app los reparte entre todos los workers prendidos; cada uno reclama el suyo):

```bash
pnpm -F @tcg/worker package   # apps/worker/build/tcg-worker-<versión>-windows.zip
```

El zip trae `tcg-worker.exe` (este worker empaquetado con Node como ejecutable único: la otra PC no necesita Node, Rust ni el repositorio), `engine-cli.exe` (el motor de `engine/target/release`, solo usa DLLs de Windows) y `LEEME.txt`. La CI lo arma en Windows en cada push a `main` (artefacto `tcg-worker-windows`, 30 días). En la otra PC: descomprimir, doble clic en `tcg-worker.exe` (pide un token de tipo worker, núcleos y nombre; prueba el motor y la conexión; instala el arranque al iniciar sesión y lo deja corriendo). `tcg-worker.exe --check`, `--once`, `--run` (lo que arranca el inicio de sesión) y `--uninstall`. Configuración y log en `%LOCALAPPDATA%\tcg-worker`, como acá; el motor se busca al lado del `.exe`. No está firmado: si vino de internet, Windows avisa («Más información → Ejecutar de todas formas»).

## Se actualiza solo (Fase 42, D-026)

El paquete portable de Windows y el de Android siguen a la app: decisión de Santiago del 11/10/2026, confiando en el servidor (HTTPS, el token de worker de cada máquina y SHA-256). El worker del repositorio (`node dist/main.js`) no se actualiza.

- **Qué baja.** `GET /api/worker/packages/<plataforma>/version` dice qué paquete trae la imagen y su `sha256`. Windows (`windows-x64`, ~3 MB) lleva `worker.cjs`, `engine-cli.exe` cruzado con zig en el Dockerfile y `determinism.json`, sin Node: el de `tcg-worker.exe` sigue. Android (`android-arm64`) es el mismo paquete del instalador.
- **Cuándo.** Al arrancar, cada 10 minutos y cuando la cola pide otro motor (`requiredEngineRev`, o el `409` de Android).
- **Antes de cambiar.** Baja a `releases/<sha256>.partial` (en stream, con la suma), verifica la suma, desempaqueta con `tar` (el de `System32` en Windows) y corre la prueba de determinismo de la versión nueva en otro proceso (`--check-engine`, a prioridad normal).
  - Si juega distinto (código 3), la marca `releases/<sha256>.bad` y no la vuelve a bajar.
  - Si falla de otra forma (un timeout con la PC cargada), reintenta, y a la tercera la marca.
- **El cambio.** Deja de reclamar, termina el chunk o lote en curso y sube los resultados. Si cambia el motor, espera además que termine la partida contra el bot en curso (hasta 6 h): al reconstruirla, el bot se recalcula. Después apunta `releases/current.json` (en Android, el enlace `current`) a la versión nueva, devuelve los leases y sale con el código 75.
- **El supervisor.** En Windows, `tcg-worker.exe --run` es un supervisor que mantiene un `tcg-worker.exe --child`: la parte que trae el `.exe` (`src/sea.ts`) carga la versión de `current.json` o, si no hay, la propia. En Android, el lanzador de `android.ts`. Si el hijo sale con 75, lo vuelve a arrancar.
- **Vuelta atrás.** Si la versión nueva sale con error antes de llegar a «worker listo» (`releases/<sha256>/healthy`), se marca mala y vuelve a la anterior.
- **Para no actualizar una máquina:** `"autoUpdate": false` en config.json o `TCG_WORKER_AUTO_UPDATE=false`. `--check` dice qué versión corre y cuál ofrece la app.
- **Motor.** Con las actualizaciones prendidas, el motor es siempre el del paquete; `enginePath` y `TCG_ENGINE_PATH` solo valen con `autoUpdate: false`.

### Pasar cada máquina, una sola vez

- **El Ryzen (paquete portable viejo).**
  1. Copiar la carpeta `tcg-worker` del zip nuevo (artefacto `tcg-worker-windows` de la CI) a la otra PC.
  2. Doble clic en `tcg-worker.exe`. Si hay un worker corriendo, ofrece detenerlo: lo que esté jugando vuelve a la cola.
  3. Enter en el token, los núcleos y el nombre para conservarlos.
- **Esta PC (hoy `node apps/worker/dist/main.js` del repositorio, motor compilado acá).** Lo mismo que el Ryzen, con la carpeta en `%LOCALAPPDATA%\tcg-worker\app` o donde se prefiera.
  - El doble clic detiene el worker del repo y conserva el token, los 18 núcleos y el nombre.
  - Saca `enginePath` de config.json y reemplaza el lanzador `tcg-pocket-worker.vbs` de la carpeta Inicio.
  - Desde ahí no hace falta recompilar el motor ni reiniciar el worker después de cada deploy.
  - Para reiniciarlo desde una sesión de Claude: `wscript.exe` sobre `%LOCALAPPDATA%\tcg-worker\launch.vbs` (o el de la carpeta Inicio si la tarea programada no se pudo crear), con `Invoke-CimMethod`, nunca con `Start-Process` (H-016).
- **El celu.**
  1. Volver a pegar el comando del instalador (Más → Tokens de API → «Worker en Android»), una vez.
  2. Enter conserva el token y las preferencias.

## Tests

`pnpm -F @tcg/worker test` usa `test/fake-engine.mjs`, un `engine-cli` falso en Node con la misma línea de comandos, archivos, progreso y códigos de salida (`games: 13` falla, `games: 99` no termina). Cubren el motor (progreso, error con código, corte por señal), el bucle (resultado y repeticiones, resultado pendiente tras un corte de red, rechazo 404, falla del motor, optimizar) y los reintentos del cliente.

## Actualizar deckgym (T-010)

El motor está fijado en un commit para que los resultados se puedan repetir y comparar. Más → Simulación avisa cuántos commits nuevos tiene deckgym-core (la app lo mira cada 12 h en producción). Para pasar a una versión nueva:

1. Mirar los cambios («Ver cambios») y elegir el commit.
2. Cambiar el `rev` de `engine/Cargo.toml` (nada más del motor) y `DEFAULT_ENGINE_REV` en `apps/api/src/config/env.ts`.
3. Compilar el motor en la PC (`cargo build --release` en `engine/`, unos 14 min) y correr los tests (`cargo test --release`).
4. Desplegar la API y sincronizar el catálogo con el motor nuevo (`POST /api/catalog/sync` o `catalog:sync --engine-rev <sha>`): ids y datos de cartas del motor.
5. Reiniciar el worker: sube qué cartas implementa el motor nuevo y la marca «no simulable» se actualiza sola (también las reimpresiones B4b re-mapeadas).
6. Las simulaciones encoladas con el motor anterior esperan un worker con ese motor (el worker lo dice en su log): cancelarlas y volver a encolarlas. Los resultados viejos quedan con su motor anotado y la columna «simulación» del mazo usa solo los del motor vigente.

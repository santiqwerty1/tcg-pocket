# @tcg/worker

Worker de simulación para la PC de Santi (BRIEF §4, PLAN §3.7, Fase 6). Pide trabajo a la app por HTTPS (solo conexiones salientes), juega cada chunk con `engine-cli` (deckgym-core, `engine/`) y sube victorias, derrotas, empates, turnos y la muestra de repeticiones. Contrato: `docs/API.md` «Simulación» → «Worker». Decisiones: `docs/DECISIONES.md` 6.1–6.15.

## Cómo funciona

1. **Reclamar**: `POST /api/worker/claim` con long-poll de 25 s; la app entrega un chunk del trabajo al que le quedan menos (a igualdad, el más viejo; `FOR UPDATE SKIP LOCKED`) con un lease de 3 minutos. Si la cola espera otro motor, contesta `requiredEngineRev` y el worker lo avisa en el log.
2. **Jugar**: escribe el trabajo en `work/<carpeta>/job.json` y corre `engine-cli simulate|optimize job.json result.json` con los núcleos configurados; lee el progreso de stderr.
3. **Latido** cada 30 s con las partidas jugadas: renueva el lease y se entera si se canceló el trabajo (entonces corta el motor).
4. **Resultado**: lo guarda primero en `state.json` y después lo sube (idempotente), con las repeticiones en gzip. Si no hay red, reintenta (1 s, 2 s, 4 s… hasta 5 min); si se apaga la PC antes de subir, lo manda al volver.
5. **Si se corta** a mitad de un chunk (PC apagada, proceso muerto), el lease vence y la app lo vuelve a encolar: se juega de nuevo con la misma semilla y da el mismo resultado.

Un error inesperado reinicia el bucle al minuto; un token rechazado (401/403) lo detiene. Corre un solo worker por carpeta (`worker.lock` con el PID): un segundo arranque avisa en el log y termina. `engine-cli` se excluye del «modo eficiencia» de Windows al arrancar: oculto, Windows lo dejaba en los núcleos de eficiencia (H-001 en la bóveda).

## Configuración

`%LOCALAPPDATA%\tcg-worker\config.json` (o variables de entorno, que mandan):

| Clave | Variable | Por defecto | Uso |
|---|---|---|---|
| `token` | `TCG_WORKER_TOKEN` | — (obligatorio) | Token `tcg_wk_…` de tipo worker (Más → Tokens de API). Solo viaja como `Authorization` a la app. |
| `server` | `TCG_SERVER` | `https://tcg-pocket.fly.dev` | URL de la app. |
| `cores` | `TCG_WORKER_CORES` | 8 (o los hilos de la PC si son menos) | Hilos por chunk. |
| `name` | `TCG_WORKER_NAME` | nombre de la PC | Cómo aparece en Más → Simulación. |
| `enginePath` | `TCG_ENGINE_PATH` | `engine/target/release/engine-cli.exe` del repo | Otro binario (por ejemplo el artefacto `engine-cli-windows` de CI). |
| — | `TCG_WORKER_DIR` | `%LOCALAPPDATA%\tcg-worker` | Carpeta de `config.json`, `worker-id`, `state.json`, `work/` y `worker.log`. |

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

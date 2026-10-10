# Medición de prioridad del worker 0.2.8 (D-023, T-015)

10/10/2026, PC de Santi: Intel Core i7-12700, 12 núcleos y 20 hilos, Windows. No se modificaron ni reiniciaron los workers o runners operativos. Se conservó la carga habitual del escritorio.

## Motor y método

Motor 0.3.3 compilado desde el worktree de Codex, en un target independiente:

```powershell
cargo build --release --manifest-path engine/Cargo.toml --target-dir engine/target-priority
node apps/worker/scripts/measure-priority.mjs
node apps/worker/scripts/measure-contention.mjs
```

El motor conserva deckgym `33ff2a5942dd4ce09d1ebc3041ffe48f604409e6` y la exclusión de EcoQoS de H-001. No se cambió código ni versión del motor. SHA256 del binario medido: `919224a8179e9f5a53279ea600cdc2e9012616eaac8e745e1c6514e8ff9a343f`. Código del worker: `4ed7019`.

Cruce fijo de la lista sintética de Mega Altaria de `package-android.mjs` contra sí misma: e2/e2, 200 partidas, semilla 20261010, 20 hilos, `perGame: true`, sin repeticiones. Cada proceso se crea oculto como en el worker y recibe la prioridad inmediatamente después de `spawn`; `getPriority` verifica el valor aplicado: 0, 10 o 19.

Los scripts consultan los jobs de GitHub antes y después de las pasadas; rechazan las que coincidan con CI en los runners `tcg-pc-*`. Una CI en el Ryzen no ocupa esta PC. Para medir en otro equipo se configura `TCG_MEASURE_RUNNER_PREFIX`. Las primeras pasadas de diagnóstico con CI se descartaron; un reintento posterior de main interrumpió la primera prueba de contención y también se descartó la pasada concurrente.

## Comparación sin CI (15:51 ART)

Tres repeticiones, alternando normal/baja; se mide el tiempo que informa el motor (`durationMs`, excluye arranque y lectura del JSON):

| Prioridad | Pasada 1 | Pasada 2 | Pasada 3 | Media | Cambio contra normal |
|---|---:|---:|---:|---:|---:|
| normal | 2307 ms | 3004 ms | 2943 ms | 2751 ms | — |
| below_normal | 2588 ms | 3191 ms | 3207 ms | 2995 ms | +8,9 % |
| idle | 3240 ms | 3267 ms | 3418 ms | 3308 ms | +20,2 % |

La mediana cambia +8,4 % con below_normal (2943 → 3191 ms). La media queda dentro del ±10 % solicitado. Hay variación entre pasadas: la primera comparación individual cambia +12,2 %, las otras +6,2 % y +9,0 %. Se conservan todos los tiempos; no se selecciona una pasada.

En las nueve ejecuciones coinciden **111 victorias A, 89 B, 0 empates y 1802 turnos**, y todo `perGame`: ganadores, primer jugador, finales, turnos y etapas de evolución por partida. Se compara todo el resultado salvo `durationMs` y rutas de repeticiones. SHA256 del JSON estable: `273233e0176dca7b90cba27c90f0860c87aff0ed3d9eeeb6f71118b659c3884d`.

No apareció la caída de rendimiento de H-001 al usar below_normal; la diferencia medida queda dentro del margen solicitado. Idle fue más lento, por lo que se conserva below_normal por defecto. Los porcentajes de CPU por hilo que registra el script son del sistema completo, no una prueba de en qué núcleo se ejecutó cada hilo del motor.

## Contención

Se repite el mismo cruce en below_normal mientras un proceso normal ejecuta trabajo fijo de PBKDF2-SHA256 en 20 hilos, con una barrera para empezar juntos: 20 millones de iteraciones por hilo. Se compara el tiempo de esa carga normal sola y acompañada por el motor. El motor puede terminar después de que la carga normal libere CPU. No se usan tiempos de una compilación con caché.

Tres repeticiones, alternando sola/acompañada, sin CI (16:01–16:03 ART):

| Pasada | Carga normal sola | Normal + motor en baja | Cambio del proceso normal | Motor en baja (tiempo de pared) |
|---|---:|---:|---:|---:|
| 1 | 16436 ms | 15927 ms | −3,1 % | 20022 ms |
| 2 | 17986 ms | 17814 ms | −1,0 % | 21210 ms |
| 3 | 16380 ms | 16913 ms | +3,3 % | 20552 ms |
| Media | 16934 ms | 16885 ms | **−0,3 %** | 20595 ms |

El proceso normal tarda prácticamente lo mismo; el motor cede CPU y tarda más. Los tres cruces concurrentes conservan el resultado completo de la prueba sin carga, con el mismo hash estable. La carga corta inicial (2 millones por hilo, menos de un segundo) se usó como diagnóstico; se alargó para reducir la variación de arranque y sostener la contención.

Datos completos: [comparación sin CI](mediciones/worker-priority-2026-10-10.json) y [contención](mediciones/worker-contention-2026-10-10.json). Los scripts dejan sus salidas en `tmp/priority-measurement/`; el hash estable se calcula sobre `JSON.stringify(result)` sin tiempo ni rutas.

## Validación y límites

Lint y typecheck del monorepo; 53 tests del worker en Windows y 56 en Linux; build, package Windows y package:android con Docker. El portable real pasó `--check` contra un servidor falso y mostró priority idle; no reclamó trabajo. ARM bajo qemu coincide con la referencia con r/e2/f2 y 1/2 hilos. Los tests simulan permisos rechazados al cambiar prioridad y verifican que el chunk igualmente termina y se reporta.

La medición corresponde a esta PC y este cruce; no se midió el Ryzen ni un teléfono real. Una prioridad menor cede CPU a los procesos normales, pero no reserva memoria ni evita el calor. La operación de los workers existentes queda a cargo del Coordinador.

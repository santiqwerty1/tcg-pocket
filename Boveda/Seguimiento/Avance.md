---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-23'
origen:
  - posta init
  - docs/PLAN.md §7
  - git log
revisar: false
---

# Avance

| Paso | Qué | Estado | Depende | Dónde |
|---|---|---|---|---|
| 0 | Exploración y plan (PLAN, DECISIONES, LICENCIAS) | hecho · aprobado 06/10 | — | [PLAN](../../docs/PLAN.md) |
| 1 | Núcleo: catálogo, colección, mazos, backup, login, deploy | hecho · desplegado 07/10 | 0 | `853bb69` |
| 2 | Registro de partidas (M6) | hecho · aprobado 08/10 | 1 | `b7c4232` |
| 3 | Claude de solo lectura (MCP), mazo más cercano, aleatorio y mejores versiones | hecho · aprobado 08/10 | 2 | `5d081ed` |
| 4 | Sobres (M4) | hecho · aprobado 08/10 ([P-005](Preguntas/P-005.md)) | 3 | `2a266b6` |
| 4.1 | Tiempo limitado, «intercambiar» y versiones | hecho 07/10 · aprobado 08/10 | 4 | [D-007](Decisiones/D-007.md), [D-008](Decisiones/D-008.md) |
| 5 | Torneos (M5) | hecho 08/10 · verificado en producción ([T-006](Tareas/T-006.md)) · aprobada al pedir la Fase 6 | 4 | [T-003](Tareas/T-003.md) |
| 6 | Simulación (M7) y worker de Windows | hecho 08/10 · desplegado · worker en producción ([T-007](Tareas/T-007.md)) · aprobado 08/10 | 5 | [T-004](Tareas/T-004.md) |
| 6.1 | Versión de torneo de cada mazo (pedido del 08/10) | hecho 08/10 · aprobado 08/10 | 6 | [D-016](Decisiones/D-016.md) |
| 7 | Claude de escritura (M8 parte 2) | hecho 08/10 · aprobado 08/10 | 6 | [D-017](Decisiones/D-017.md) |
| 7.1 | Laboratorio de mazos (pedido del 08/10) | hecho 08/10 · desplegado (`dc2dcad`) · aprobado 08/10 | 7 | [T-008](Tareas/T-008.md), [D-018](Decisiones/D-018.md) |
| 8 | Jugar contra un bot, consistencia, sustitutos, avisos y misiones | hecho 08/10 · desplegado (`d8728e7`), catálogo con misiones · aprobado 08/10 | 7.1 | [T-011](Tareas/T-011.md), [D-019](Decisiones/D-019.md) |
| 8.1 | Respuestas de D-019 (consistencia contra el meta, backup v5), archivar simulaciones, instalar en Android | hecho 08/10 · desplegado (`ee6f4bd`), worker 0.2.1 · aprobado 08/10 | 8 | [D-019](Decisiones/D-019.md) |
| 9 | Matchups de torneo (rondas de Limitless) | hecho 08/10 · desplegado 09/10 (`87b36dc`) | 8 | [T-012](Tareas/T-012.md) |
| 10 | Calculadora de mano inicial | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 11 | Meta semanal | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 12 | Notas por rival | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 13 | ¿Mala racha o mal matchup? | hecho 08/10 · desplegado 09/10 (`87b36dc`) | 9 | [T-012](Tareas/T-012.md) |
| 14 | ¿Cuántos días me faltan? | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 15 | ¿Qué mazo llevo hoy? | hecho 08/10 · desplegado 09/10 (`87b36dc`) | 9 | [T-012](Tareas/T-012.md) |
| 16 | Eventos con restricciones | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 17 | Suerte de los sobres | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 18 | Notificaciones al celu | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 19 | Armar desde un núcleo | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 20 | Modo entrenador contra el bot | hecho 08/10 · desplegado 09/10 (`87b36dc`) | — | [T-012](Tareas/T-012.md) |
| 21 | Mantenimiento: remapeo de ids (I12) y CI | hecho 08/10 · desplegado | — | [R-001](Riesgos/R-001.md), [R-007](Riesgos/R-007.md) |
| 22 | La mesa: visor de repeticiones y partidas contra el bot | hecho 09/10 · desplegado · aprobado 09/10 | — | — |
| 22.1 | La mesa: unir una herramienta tocando y auditoría de todas las elecciones de deckgym (pedido de Santi del 12/10) | hecho 12/10 (#69 y #70, DECISIONES 55.1–55.6) · en producción · [H-053](Hallazgos/H-053.md) resuelto · el fósil duplicado es de deckgym y está reportado ([H-052](Hallazgos/H-052.md)) | 22 | — |
| 23 | Jugar contra la lista exacta de un torneo reciente | hecho 09/10 · desplegado · aprobado 09/10 | — | — |
| 24 | Situaciones para resolver | hecho 09/10 · desplegado · aprobado 09/10 | — | — |
| 25 | ¿Empezaste vos? y estadísticas por orden de turno | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 26 | Pantalla «Hoy» | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 27 | Buscador único | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 28 | Cargar partidas sin señal | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 29 | Claude analiza una partida | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 30 | Ejercicios de cálculo | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 31 | Lista de intercambio | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 32 | Resumen semanal | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 33 | Partidas contra el bot al instante | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 34 | Tests de pantallas en la CI | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| 35 | Prueba mensual del backup | hecho 09/10 · desplegado (`0524489`) · aprobado 09/10 | — | [T-013](Tareas/T-013.md) |
| E | Evaluación de mejoras: 14 hallazgos, riesgos, preguntas y fases propuestas 36 a 45 | hecho 09/10 · verificada 09/10 · aprobada 09/10 ([D-020](Decisiones/D-020.md)) | 35 | [Evaluación](Evaluacion-2026-10-09.md), [T-014](Tareas/T-014.md) |
| 36 | Arreglos confirmados (y tope de 3 energías, [P-006](Preguntas/P-006.md)) | hecho 09/10 · desplegado (`55d658d`) | E | [T-014](Tareas/T-014.md) |
| 37 | Números honestos | hecho 09/10 · desplegado · H-011.5 completado por #32 el 10/10 | 36 | [T-014](Tareas/T-014.md) |
| 38 | Operación y avisos | hecho 09/10 · desplegado en `52c87e3` · pendiente configurar UptimeRobot ([P-011](Preguntas/P-011.md)) · 18/10: las migraciones verifican el certificado de la base y producción exige `verify-full` (#116, [H-058](Hallazgos/H-058.md) resuelto) · 19/10: `catalog-sync.js` dice antes de escribir qué commit y qué `engineRev` usa (#135, DECISIONES 41.25) | 37 | [T-014](Tareas/T-014.md) |
| 39 | Copia fuera de Supabase y retención ([P-007](Preguntas/P-007.md): en la nube) | hecho 09/10 · desplegado en `52c87e3` · en producción el 12/10, con el OK de Santi: bucket `tcg-pocket-backups` en Tigris, primera limpieza (5.730 repeticiones, 39,1 MB) y `RETENTION_CRON=true` (DECISIONES 42.7, [P-010](Preguntas/P-010.md) cerrada) · falta registrar la primera subida buena ([R-006](Riesgos/R-006.md)) | 38 | [T-014](Tareas/T-014.md) |
| 40 | Día de expansión en dos toques | hecho 09/10 (#31, DECISIONES 43.1–43.8) · desplegado en `52c87e3` · [H-004](Hallazgos/H-004.md) resuelto | 39 | [T-014](Tareas/T-014.md) |
| 41 | Interfaz | hecho 09/10 (Nube-Mejoras, DECISIONES 44.1–44.11) · desplegado (`773ad00`) · [P-012](Preguntas/P-012.md): un 401 conserva el service worker | 40 | [T-014](Tareas/T-014.md) |
| 42 | Simulaciones más baratas y calibradas | hecho 14/10 · fase completa: «dos lugares por worker» cerrado con `worker-timing` (#102, DECISIONES 45.63) y «optimizar» con dos copias (#97/#99, [H-050](Hallazgos/H-050.md) resuelto) · la calibración grande e2/e3/MCTS con el motor nuevo, lanzada el 19/10 por el Coordinador ([D-031](Decisiones/D-031.md)): la e2 de 18 listas (79) da lo mismo que la del 10/10 · 20–21/10: con el banco grande de [D-029](Decisiones/D-029.md), e3 (83) queda más cerca de los torneos que e2 (82), y MCTS (85) como e2 · 22/10: la de g2 (86), corriendo · [R-012](Riesgos/R-012.md) y [H-052](Hallazgos/H-052.md) abiertos | 41 | [T-014](Tareas/T-014.md) |
| 43 | Claude | hecho 09/10 · chat-puente #12 y seguimiento #34 integrados · desplegado en `52c87e3` · locks en deshacer/restaurar y marca transaccional para borrados «Sin terminar» | 42 | [T-014](Tareas/T-014.md), [R-010](Riesgos/R-010.md) |
| 44 | Análisis nuevos | hecho · parte 1 (44a–c) en #17, desplegada en `52c87e3` · parte 2 hecha 11/10 (Nube-Mejoras, DECISIONES 47.7–47.17) en #55, que reemplaza a #52: moneda pareja, «mi meta», Zona de Energía, robo con cartas que buscan, misiones en Sobres y «¿Qué armo después?» · en producción | 43 | [T-014](Tareas/T-014.md) |
| W | Más workers: nube, Android y navegador (reemplaza la 45, [P-008](Preguntas/P-008.md)) | en curso · Android adelantado por Santi: #38, #40, #41 y #43 (worker 0.2.8–0.2.11, [D-025](Decisiones/D-025.md)), con la prioridad baja de #39 · se actualizan solos desde 0.3.0 (#50, [D-026](Decisiones/D-026.md)): la PC y el celu ya pasaron, falta el Ryzen (13/10) · 12/10: worker 0.3.2 (`--setup --keep`, #63), 0.3.3 (`gamesRev`, #68), 0.3.4 (el resultado perdido no gasta el chunk, con pausa visible, #72, [H-054](Hallazgos/H-054.md)) y 0.3.5 (un push por pausa, #74) · falta que Santi ponga Termux «Sin restricciones» en la batería y el visto bueno en el teléfono · 14/10: diagnóstico de salidas del motor (#100), retomar desde la partida N (#104/#105, [H-054](Hallazgos/H-054.md)) y el regulador de CPU (#106, worker 0.3.9) · 15/10: seguimiento del regulador (#110, worker 0.3.10) y el motor del fork (#115, worker 0.3.11) · 18/10: los huecos del S25 son Android que corta Termux, no la cola · 19/10: worker 0.3.12 (#133) y 0.3.13 (#138); la PC se actualizó sola las dos veces, la Ryzen sigue en 0.2.7 y no puede jugar, y el S25 se conectó un rato, se actualizó y se cortó · 22/10: worker 0.3.14 (#142) y el aviso `worker_idle` con `allowSlowBots` (#144) · navegador: #57 cerrado por la mudanza, rama en el repo público · nube sin empezar | 44 | [T-015](Tareas/T-015.md) |
| A | Adelantar simulaciones desde la app; laboratorio, explorar y consistencia siempre antes | hecho 11/10 (#42, DECISIONES 50.1–50.4) · en producción | — | [T-018](Tareas/T-018.md), [D-024](Decisiones/D-024.md) |
| N | Análisis de todas las simulaciones (Más → Simulación → Análisis, tool `simulations_analysis`) | hecho 11/10 (#45, DECISIONES 52.1–52.7) · en producción · método propuesto, sin aprobar | — | [T-019](Tareas/T-019.md), [D-027](Decisiones/D-027.md) |
| C | Colección directo desde el tracker, sin CSV | hecho 11/10 (#56, DECISIONES 54.1–54.11) · en producción · secreto `TRACKER_COLLECTION_ANON_KEY` cargado en Fly antes del deploy de `e08e502` · la automática, apagada hasta que Santi pruebe a mano · método propuesto, sin aprobar | — | [T-020](Tareas/T-020.md), [D-028](Decisiones/D-028.md) |
| M | Mudanza a repo público: historia completa reescrita y PR recreados | hecho 11/10 · `santiqwerty1/tcg-pocket` público (main `abd5034`) y el privado, archivado como `tcg-pocket-historial` · CI en los runners de GitHub · tag `v1.0.0` y release «TCG Pocket 1.0.0» en `2fd579e`, el commit de #62, que pasa los `package.json` a 1.0.0 ([P-013](Preguntas/P-013.md) cerrada, DECISIONES 41.19) | — | [D-022](Decisiones/D-022.md), [D-023](Decisiones/D-023.md) |
| L | Búsqueda del laboratorio: probar siempre los cambios obvios (+1 copia, paso hacia la lista de torneo) | pendiente, para cuando Santiago la pida | — | [T-016](Tareas/T-016.md) |
| O | Optimización de mazos: análisis del 09/10 (bot que no evoluciona, velocidad, semillas, búsqueda) | T-017 en curso · #5, #15, #20, #22, #25, #27 y #28 integrados: bot f, aprendizaje/combo, explicaciones, frenar, deshacer, Energía y segundas listas del banco · revisión #35 integrada · 11/10: D4 (#47), partidas por peso y confirmación con e3 (#49) y carreras (#53) · 12/10: E3/E4 y lo que quedaba de #47 y #49 (#64, DECISIONES 40.26–40.27) · 13/10: C3, A3 y C8 · 14–15/10: «Probar estas cartas» con cualquier carta (#107 y #113) y «Actualizar todos» (#109) · 18/10: la deuda 2–5 (#118 y #121) y el aviso de punto ciego de Infra (#119, #122 y #124) · e2 sigue por defecto ([D-029](Decisiones/D-029.md)); puntos ciegos en [H-055](Hallazgos/H-055.md) | — | [Optimización](Optimizacion-2026-10-09.md), [T-017](Tareas/T-017.md) |
| F | Fork de deckgym con arreglos (Casco Pesado, Extracto y Plubio, pánico sin Activo) | en producción desde el 15/10 (#115, `dfc8b05`, fork en `018b419`; [H-056](Hallazgos/H-056.md) resuelto) · 18/10: Santiago aprobó rearmarlo sobre upstream `adfe505` con solo `fix/choose-evolution-target` y `feat/bot-api` · 19/10: en producción en `0b510d1` (#133, `f249a9b`; deploy de `83dcb40`, engine-cli 0.3.14 y worker 0.3.12, DECISIONES 51.50–51.53) y, desde la noche, en `c87bad0` (deckgym-core#1 y #138, deploy de `051ed96`, engine-cli 0.3.15 y worker 0.3.13, 51.54–51.57) · calibraciones con el motor nuevo: e2 (79), e2 y e3 con el banco grande (82 y 83) y MCTS (85) · 21/10: bcollazo/deckgym-core#420 integrado upstream (`dfe6ff3`) · 22/10, Santiago: el motor no se mueve hasta que upstream cargue C1, y ese día entra todo junto | — | [D-031](Decisiones/D-031.md), [H-056](Hallazgos/H-056.md) |
| B | Bots más fuertes: daño real, sin trampa, afinado y evaluación aprendida | en curso (sesión «Bots» en la nube) · diseño (#111, 15/10) y bot «g» opcional (#117, 18/10, engine-cli 0.3.13); e2 sigue por defecto ([D-029](Decisiones/D-029.md)) · 19/10: g 1.1 (#128), g 1.1.1 (#139) y g 1.1.2 (#140) integrados; en la liga, g2 le gana a e2 68,7 % y a f2 63,5 % · 22/10: la app acepta g (#142, desplegado), el seguimiento (#144) y `scripts/bots-bank.mjs` (#146); los mazos 16, 23 y 40 medidos de nuevo; la calibración con g2 (86), corriendo · la línea 2, a una sesión nueva · 23/10: **g2 es el bot por defecto** (#155, [D-029](Decisiones/D-029.md)), con los puntajes del laboratorio recalculados | F | [T-021](Tareas/T-021.md), [H-055](Hallazgos/H-055.md) |
| P | Partidas: rival por cartas vistas y ranked por temporada y rango | hecho 18/10 · rival por cartas vistas (#114) y ranked (#120), desplegados, con su deuda en #131 y #130 · 19/10: arquetipo asignado al rival de 20 partidas, y «mi meta» ya tiene 19,9 efectivas · Master Ball anotado por Santiago el 19/10 · 22/10: «Importar desde la hoja» (#143) · [H-060](Hallazgos/H-060.md): tres bloqueos cruzados que ya existían | — | [T-022](Tareas/T-022.md) |
| H | Hub de chat propio (`santiqwerty1/chat-hub`) | en curso (Principal) · D1–D9 aprobadas · H1–H3, H6 y H5 integrados (chat-hub #1–#11), sin desplegar · T1a (#123 y #126) y T1b (#129) en tcg-pocket · chat-hub #12 y #13 integrados · el paso 5 espera el paso 2 de Santiago, el incremento 5 de Posta en su main y el token `HUB_MCP_TOKEN` | — | [D-030](Decisiones/D-030.md) |
| C1 | C1 «Dual Fusion»: la app lista para el doble tipo antes del 29/10 | hecho lo que no depende de upstream · 22–23/10: #145, #149, #151, #147, #154 y el runbook #152, desplegados (`63c09fe` y `c247f20`) · el 29/10 la app pasa sola a C1 (Santiago) · issue upstream bcollazo/deckgym-core#429 · falta el motor de C1 cuando deckgym lo cargue ([D-031](Decisiones/D-031.md)) | — | [T-023](Tareas/T-023.md) |
| G | La colección real desde ptcgpocket.gg y el archivo para el tracker | hecho 23/10 · #150 y #153 desplegados · Santiago guardó el link y el juego, la app y el tracker coinciden (5.128 copias) | — | [T-024](Tareas/T-024.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · aprobado 08/10 | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

**Producción al 23/10/2026:** desplegada hasta `c247f20` (#155), con la sincronización de ptcgpocket.gg (#150, #153), C1 (#147, #149, #151, #154) y g2 por defecto. Versión 1.0.0, engine-cli 0.3.16 y worker 0.3.14, con el regulador de CPU prendido. El motor es la copia de deckgym en `c87bad0` ([D-031](Decisiones/D-031.md)), y el catálogo, el tracker en `aac8d456`. Los workers se actualizan solos ([D-026](Decisiones/D-026.md)), salvo la Ryzen, que sigue con 0.2.7. El S25 volvió el 23/10, con 0.3.14. El id de la máquina se busca con `flyctl machine list --app tcg-pocket`. **Simulaciones:** las calibraciones 82, 83 y 86 (e2, e3 y g2) con el banco grande, y los puntajes del laboratorio con g2 (87–89). La cola está vacía.

**Repo:** `santiqwerty1/tcg-pocket` es público desde el 11/10 ([D-022](Decisiones/D-022.md)). main está protegida (privacy, test, e2e y screens requeridos) y, desde el 18/10, con `enforce_admins`: tampoco la cuenta de Santiago empuja directo. El hub de chat vive en `santiqwerty1/chat-hub` (privado, [D-030](Decisiones/D-030.md)), con la CI en un runner propio de la PC de Santiago.

**Permisos desde #132 (18/10, [D-021](Decisiones/D-021.md)):** `git push` a una rama de PR no pide confirmación; main, forzar y borrar sí.

**Flujo desde el 13/10** (`docs/REVISION.md`): autorrevisión antes de cada PR, decisiones pendientes sin número (las numera `pnpm decisiones` al integrar, en el orden en que entraron), revisión según el riesgo, sesiones que rotan, y a Santiago se le escribe solo para decidir o hacer algo. **Deploys desde una copia limpia de main:** Posta deja relevos sin commitear en `Boveda/Sesiones/`.

**Turno de e2e desde el 15/10:** un solo e2e o build pesado a la vez entre todas las sesiones, anunciado en el chat con «e2e: arranco» y «e2e: listo», y vitest con `--maxWorkers=2`. WSL tiene un tope de 6 GB de memoria en `.wslconfig`, aprobado por Santiago. La CI del hub y la de Posta corren en esta PC, así que también usan el turno.

Lo que sigue, en orden:

1. **Arreglos chicos después de g2** (una sesión, en curso): la descripción de `decks_pick_today`, el push de «era nueva probable», que sale una sola vez, y el costo de e3 en las estimaciones.
2. **C1, el día de la salida (29/10, [T-023](Tareas/T-023.md)):** la app pasa sola a C1. Cuando el tracker cargue las cartas, sincronizar el catálogo con la vista previa (runbook en `docs/OPERACION.md`). Cuando deckgym cargue C1, el cambio de motor de [D-031](Decisiones/D-031.md), con el diferencial y los puntajes recalculados con g2.
3. **[H-055](Hallazgos/H-055.md):** proponer a Santiago cerrarla como explicada, con g2 como arreglo.
4. **La línea 2 de los bots, sin trampa ([T-021](Tareas/T-021.md)):** en una sesión nueva, con el traspaso de Bots del 22/10.
5. **[H-060](Hallazgos/H-060.md):** los cuatro bloqueos cruzados que ya existían, en una tanda de riesgo alto.
6. **El hub ([D-030](Decisiones/D-030.md)):** el paso 5 espera el paso 2 de Santiago, el incremento 5 de Posta en su main y el token `HUB_MCP_TOKEN`. Después, el cambio de «posta», H4 y T2.
7. **Santiago:**
   - los relevos viejos de Posta;
   - el paso 2 del hub;
   - en la Ryzen, actualizar el worker (sigue en 0.2.7) y lo demás del paquete `tcg-ryzen-13oct-v2.zip`;
   - los 43 términos de las traducciones de los premios de las misiones;
   - Termux «Sin restricciones» en la batería del S25 ([H-054](Hallazgos/H-054.md), [T-015](Tareas/T-015.md)); el S25 volvió a conectarse el 23/10;
   - en esta PC, el runner Windows de la CI de Posta;
   - si quiere, prender la sincronización diaria de ptcgpocket.gg.
8. **Privacidad del mail en GitHub** (recomendación para Santiago): activar «Keep my email addresses private» y «Block command line pushes that expose my email» ([R-013](Riesgos/R-013.md)).
9. **Menores:** [T-016](Tareas/T-016.md) sigue para cuando Santiago lo pida; revisar en la mesa que el fósil se vea una sola vez, para cerrar [H-052](Hallazgos/H-052.md).

Hechos desde la actualización del 14/10 (lo del 23/10, al final):
- 15/10: #109 («Actualizar todos»), #110 (seguimiento del regulador), #111 (diseño del bot «g»), #113 (seguimiento de #107) y #115 (el fork de deckgym, [H-056](Hallazgos/H-056.md) resuelto), con tres deploys; chat-hub #7 (H6);
- 18/10: #114 y #120 ([T-022](Tareas/T-022.md) hecha), #116 ([H-058](Hallazgos/H-058.md)), #117 (el bot «g»), #118 y #121 (deuda del laboratorio), #119, #122 y #124 (el aviso de punto ciego, [H-055](Hallazgos/H-055.md)), #123 y #126 (T1a del hub) y #125, con seis deploys; chat-hub #8–#11 (H6.8 y H5);
- la pausa general del 15/10 a las 17:05 al 18/10 a las 02:46, por el límite semanal de la cuenta;
- el diagnóstico de Dedenne ex y la aprobación del fork sobre `adfe505`;
- 18/10, por la tarde: #129 (T1b del hub), #130 y #131 (la deuda de ranked y de rivales) y #132 (permisos), con un deploy; `enforce_admins` en main; chat-hub #12 y #13; las cinco mejoras de la hoja de partidas de Santiago;
- 19/10: #133 (el motor nuevo, `0b510d1`), #134 (la prueba de ranked de medianoche) y #135 (`catalog-sync` dice qué usa), con el deploy de `83dcb40`, el sync del catálogo y las simulaciones relanzadas (trabajos 72–75, después de [H-059](Hallazgos/H-059.md)); el arquetipo de 20 rivales, para «mi meta»;
- 19/10, a la tarde: #137 ([H-059](Hallazgos/H-059.md), resuelto), #128, #139 y #140 (g 1.1, 1.1.1 y 1.1.2) y #138 (el motor en `c87bad0`, con deckgym-core#1), con los deploys de `703b89b` y `051ed96`; la matriz 75 terminada; los puntajes del laboratorio (76–78) y las calibraciones con el motor nuevo (79, y 82–84 con el banco grande de D-029); Master Ball anotado por Santiago.
- 20–21/10: las calibraciones e2 y e3 con el banco grande (82 y 83) y MCTS (85); bcollazo/deckgym-core#420 integrado upstream;
- 22/10: #142 (la app acepta g), #144, #146, #143 («Importar desde la hoja») y #145 (C1, el lector del tracker), con los deploys de `cc36161` y `41ee9b8`; los mazos 16, 23 y 40 medidos de nuevo; la calibración con g2 (86); la revisión de C1 y la sesión de ptcgpocket.gg; la limpieza de ramas y worktrees, y los textos de GitHub sin el usuario de Windows.

- 22/10 a la noche y 23/10: #150 y #153 (ptcgpocket.gg), #149, #151, #147, #154 y #152 (C1), y #155 (g2 por defecto), con los deploys de `53528ca`, `75e039f`, `63c09fe` y `c247f20`; el catálogo en `aac8d456`; la calibración con g2 y los puntajes del laboratorio con g2; el issue upstream del doble tipo; la limpieza de ramas y worktrees (0 rastros del usuario de Windows).
Todo entra por PR, con la CI verde y la revisión del Coordinador. Las sesiones se hablan por el chat externo al repo, en las salas «tcg» y «posta»; Bots, por el chat de la app.

## Pendiente de decidir (para después)

Decididas por Santiago el 08/10/2026: D-007, D-008, D-009, D-011, D-012, D-013, D-014, D-015, D-016, D-017, D-018 y D-019 (ver cada ficha). El 09/10/2026: [D-020](Decisiones/D-020.md), y respondidas [P-006](Preguntas/P-006.md) (máximo 3 energías), [P-007](Preguntas/P-007.md) (copia en la nube) y [P-008](Preguntas/P-008.md) (las tres opciones, en [T-015](Tareas/T-015.md)).

El 11/10/2026:
- **Decididas por Santiago:**
  - [D-024](Decisiones/D-024.md): «Las cortas siempre primero»;
  - [D-026](Decisiones/D-026.md): los workers se actualizan solos, confiando en el servidor;
  - el cambio de [D-022](Decisiones/D-022.md): la historia completa;
  - y respondida [P-013](Preguntas/P-013.md): tag y release, sí.
- **Decidida por el Coordinador** e informada a Santiago: [D-025](Decisiones/D-025.md).

El 12/10/2026:
- **Respuestas de Santiago**, por el Coordinador: sí a los issues upstream de deckgym (bcollazo/deckgym-core#397 y #398), a Tigris (aceptó los términos), a la primera limpieza y a dejarla automática ([P-010](Preguntas/P-010.md), cerrada).
- **Decididas por el Coordinador**, dentro de la fase 42 ya aprobada: el diseño de `gamesRev` (DECISIONES 45.46 y 45.54), la regla de las copias (45.50), «Reintentar lo que falló» (45.49), la tool `simulations_calibration` (45.52) y mover el tag `v1.0.0` al commit de #62 (41.19; [P-013](Preguntas/P-013.md), cerrada).
- **Decidida por Santiago:** los commits ya publicados con el mail personal como autor quedan como están; se corrige solo hacia adelante, con el noreply en la configuración local ([R-013](Riesgos/R-013.md)).
- **Esperaban aprobación:** [D-027](Decisiones/D-027.md) y [D-028](Decisiones/D-028.md), aprobadas el 13/10.

El 13/10/2026:
- **Aprobadas por Santiago:** [D-027](Decisiones/D-027.md) y [D-028](Decisiones/D-028.md).
- **Decididas por Santiago:** [D-029](Decisiones/D-029.md) (e2 sigue de bot por defecto), [D-030](Decisiones/D-030.md) (hub de chat propio; D1–D9 aprobadas el 14/10), dejar el S25 con los bots lentos hasta el arreglo de H-054, y UptimeRobot.
- **Esperaban a Santiago:** D1–D9 del hub, aprobadas el 14/10. Siguen esperando los 43 términos de las traducciones.

El 15/10/2026:
- **Decididas por Santiago:** la determinización de la línea 2 de los bots supone la lista típica del arquetipo en el meta ([T-021](Tareas/T-021.md)); el tope de 6 GB de memoria para WSL; y, durante la pausa, el worker de la PC con los 20 núcleos y la PC sin suspenderse hasta el martes 20/10.

El 18/10/2026:
- **Decidida por Santiago:** la integración nueva del fork sobre upstream `adfe505` con solo `fix/choose-evolution-target` y `feat/bot-api` ([D-031](Decisiones/D-031.md)).
- **Aprobado por Santiago, por Posta-Coordinador:** el runner de la CI de Posta en WSL pasa a ser un servicio de usuario de systemd con linger, que arranca con WSL. Se probó con `wsl --terminate Ubuntu`.
- **Dato de Santiago:** está en Master Ball, y las 26 partidas de ranked del 17 y 18/10 fueron todas en Master Ball ([T-022](Tareas/T-022.md)).
- **Decidido por Santiago:** menos aprobaciones a mano, con los comandos seguros y `git push` a las ramas que no son main (#132, [D-021](Decisiones/D-021.md)), y `enforce_admins` en main.
- **Decidido por Santiago:** las mejoras de su hoja de partidas las hace otra conversación de Claude, la que tiene el conector de Google Sheets.
- **Decidido por el Coordinador:** g puede costar hasta 3,5 veces lo que e2 mientras la app no lo use ([T-021](Tareas/T-021.md)).

El 19/10/2026:
- **Decidido por el Coordinador:** la regla para los hallazgos de Codex en g. Se arregla lo que el reloj ya modela mal; lo que pide modelar algo nuevo va a la deuda; los pánicos, los cruces que fallan y las filtraciones de lo oculto se arreglan siempre ([T-021](Tareas/T-021.md)).

El 22/10/2026:
- **Decididas por Santiago:** C1 con los PR 3 y 4 antes del 29/10, el issue upstream del doble tipo, el sobre especial aparte y apagado, y los Community Decks para más adelante ([T-023](Tareas/T-023.md)); el motor no se mueve hasta que upstream cargue C1 ([D-031](Decisiones/D-031.md)); la sincronización con ptcgpocket.gg ([T-024](Tareas/T-024.md)); y, por Posta-Coordinador, las ramas locales viejas se revisan y las borra él.
- **Decidido por el Coordinador:** el P2 de Codex de #144 queda como límite conocido (DECISIONES 48.20).
- **Espera a Santiago:** el bot por defecto, con la calibración de g2 ([D-029](Decisiones/D-029.md)).

El 23/10/2026:
- **Decididas por Santiago:** `Collected` FALSE con 0 copias en el archivo para el tracker (22/10, a la noche); el 29/10 la app pasa sola a C1; g2 es el bot por defecto ya ([D-029](Decisiones/D-029.md)); borrar las ramas locales viejas y los worktrees de Codex.

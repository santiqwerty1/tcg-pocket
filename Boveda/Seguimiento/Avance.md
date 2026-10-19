---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-19'
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
| 42 | Simulaciones más baratas y calibradas | hecho 14/10 · fase completa: «dos lugares por worker» cerrado con `worker-timing` (#102, DECISIONES 45.63) y «optimizar» con dos copias (#97/#99, [H-050](Hallazgos/H-050.md) resuelto) · la calibración grande e2/e3/MCTS se relanza con el motor nuevo, en producción desde el 19/10 ([D-031](Decisiones/D-031.md)); la lanza Santiago desde la app · [R-012](Riesgos/R-012.md) y [H-052](Hallazgos/H-052.md) abiertos | 41 | [T-014](Tareas/T-014.md) |
| 43 | Claude | hecho 09/10 · chat-puente #12 y seguimiento #34 integrados · desplegado en `52c87e3` · locks en deshacer/restaurar y marca transaccional para borrados «Sin terminar» | 42 | [T-014](Tareas/T-014.md), [R-010](Riesgos/R-010.md) |
| 44 | Análisis nuevos | hecho · parte 1 (44a–c) en #17, desplegada en `52c87e3` · parte 2 hecha 11/10 (Nube-Mejoras, DECISIONES 47.7–47.17) en #55, que reemplaza a #52: moneda pareja, «mi meta», Zona de Energía, robo con cartas que buscan, misiones en Sobres y «¿Qué armo después?» · en producción | 43 | [T-014](Tareas/T-014.md) |
| W | Más workers: nube, Android y navegador (reemplaza la 45, [P-008](Preguntas/P-008.md)) | en curso · Android adelantado por Santi: #38, #40, #41 y #43 (worker 0.2.8–0.2.11, [D-025](Decisiones/D-025.md)), con la prioridad baja de #39 · se actualizan solos desde 0.3.0 (#50, [D-026](Decisiones/D-026.md)): la PC y el celu ya pasaron, falta el Ryzen (13/10) · 12/10: worker 0.3.2 (`--setup --keep`, #63), 0.3.3 (`gamesRev`, #68), 0.3.4 (el resultado perdido no gasta el chunk, con pausa visible, #72, [H-054](Hallazgos/H-054.md)) y 0.3.5 (un push por pausa, #74) · falta que Santi ponga Termux «Sin restricciones» en la batería y el visto bueno en el teléfono · 14/10: diagnóstico de salidas del motor (#100), retomar desde la partida N (#104/#105, [H-054](Hallazgos/H-054.md)) y el regulador de CPU (#106, worker 0.3.9) · 15/10: seguimiento del regulador (#110, worker 0.3.10) y el motor del fork (#115, worker 0.3.11) · 18/10: los huecos del S25 son Android que corta Termux, no la cola · 19/10: worker 0.3.12 con el motor nuevo (#133); la PC se actualizó sola, la Ryzen sigue en 0.2.7 y no puede jugar, y el S25 está apagado desde el 18/10 · navegador: #57 cerrado por la mudanza, rama en el repo público · nube sin empezar | 44 | [T-015](Tareas/T-015.md) |
| A | Adelantar simulaciones desde la app; laboratorio, explorar y consistencia siempre antes | hecho 11/10 (#42, DECISIONES 50.1–50.4) · en producción | — | [T-018](Tareas/T-018.md), [D-024](Decisiones/D-024.md) |
| N | Análisis de todas las simulaciones (Más → Simulación → Análisis, tool `simulations_analysis`) | hecho 11/10 (#45, DECISIONES 52.1–52.7) · en producción · método propuesto, sin aprobar | — | [T-019](Tareas/T-019.md), [D-027](Decisiones/D-027.md) |
| C | Colección directo desde el tracker, sin CSV | hecho 11/10 (#56, DECISIONES 54.1–54.11) · en producción · secreto `TRACKER_COLLECTION_ANON_KEY` cargado en Fly antes del deploy de `e08e502` · la automática, apagada hasta que Santi pruebe a mano · método propuesto, sin aprobar | — | [T-020](Tareas/T-020.md), [D-028](Decisiones/D-028.md) |
| M | Mudanza a repo público: historia completa reescrita y PR recreados | hecho 11/10 · `santiqwerty1/tcg-pocket` público (main `abd5034`) y el privado, archivado como `tcg-pocket-historial` · CI en los runners de GitHub · tag `v1.0.0` y release «TCG Pocket 1.0.0» en `2fd579e`, el commit de #62, que pasa los `package.json` a 1.0.0 ([P-013](Preguntas/P-013.md) cerrada, DECISIONES 41.19) | — | [D-022](Decisiones/D-022.md), [D-023](Decisiones/D-023.md) |
| L | Búsqueda del laboratorio: probar siempre los cambios obvios (+1 copia, paso hacia la lista de torneo) | pendiente, para cuando Santiago la pida | — | [T-016](Tareas/T-016.md) |
| O | Optimización de mazos: análisis del 09/10 (bot que no evoluciona, velocidad, semillas, búsqueda) | T-017 en curso · #5, #15, #20, #22, #25, #27 y #28 integrados: bot f, aprendizaje/combo, explicaciones, frenar, deshacer, Energía y segundas listas del banco · revisión #35 integrada · 11/10: D4 (#47), partidas por peso y confirmación con e3 (#49) y carreras (#53) · 12/10: E3/E4 y lo que quedaba de #47 y #49 (#64, DECISIONES 40.26–40.27) · 13/10: C3, A3 y C8 · 14–15/10: «Probar estas cartas» con cualquier carta (#107 y #113) y «Actualizar todos» (#109) · 18/10: la deuda 2–5 (#118 y #121) y el aviso de punto ciego de Infra (#119, #122 y #124) · e2 sigue por defecto ([D-029](Decisiones/D-029.md)); puntos ciegos en [H-055](Hallazgos/H-055.md) | — | [Optimización](Optimizacion-2026-10-09.md), [T-017](Tareas/T-017.md) |
| F | Fork de deckgym con arreglos (Casco Pesado, Extracto y Plubio, pánico sin Activo) | en producción desde el 15/10 (#115, `dfc8b05`, fork en `018b419`; [H-056](Hallazgos/H-056.md) resuelto) · 18/10: Santiago aprobó rearmarlo sobre upstream `adfe505` con solo `fix/choose-evolution-target` y `feat/bot-api` · 19/10: en producción en `0b510d1` (#133, `f249a9b`; deploy de `83dcb40`, engine-cli 0.3.14 y worker 0.3.12, DECISIONES 51.50–51.53) y catálogo sincronizado · falta relanzar las calibraciones | — | [D-031](Decisiones/D-031.md), [H-056](Hallazgos/H-056.md) |
| B | Bots más fuertes: daño real, sin trampa, afinado y evaluación aprendida | en curso (sesión «Bots» en la nube) · diseño (#111, 15/10) y bot «g» opcional (#117, 18/10, engine-cli 0.3.13); e2 sigue por defecto ([D-029](Decisiones/D-029.md)) · g 1.1 en #128 (abierto el 18/10): «atacar ahora», los hilos de Codex y Dedenne; entra cuando el banco corra sin fallas · después, el PR del fork que ahorra costo, la app acepta g y la línea 2 | F | [T-021](Tareas/T-021.md), [H-055](Hallazgos/H-055.md) |
| P | Partidas: rival por cartas vistas y ranked por temporada y rango | hecho 18/10 · rival por cartas vistas (#114) y ranked (#120), desplegados, con su deuda en #131 y #130 · 19/10: arquetipo asignado al rival de 20 partidas, y «mi meta» ya tiene 19,9 efectivas · falta que Santiago anote Master Ball desde la partida 6 | — | [T-022](Tareas/T-022.md) |
| H | Hub de chat propio (`santiqwerty1/chat-hub`) | en curso (Principal) · D1–D9 aprobadas · H1–H3, H6 y H5 integrados (chat-hub #1–#11), sin desplegar · T1a (#123 y #126) y T1b (#129) en tcg-pocket · chat-hub #12 y #13 integrados · el paso 5 espera el paso 2 de Santiago, el incremento 5 de Posta en su main y el token `HUB_MCP_TOKEN` | — | [D-030](Decisiones/D-030.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · aprobado 08/10 | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

**Producción al 19/10/2026:** desplegada hasta `83dcb40` (#134). #135 (`419572c`) entra con el próximo deploy. Versión 1.0.0, engine-cli 0.3.14 y worker 0.3.12, con el regulador de CPU prendido. El motor es la copia de deckgym en `0b510d1`, sobre upstream `adfe505` ([D-031](Decisiones/D-031.md)), con el catálogo sincronizado. Los workers se actualizan solos ([D-026](Decisiones/D-026.md)), salvo la Ryzen, que sigue con 0.2.7 y no puede jugar con el motor nuevo. El id de la máquina cambia con los deploys que la reemplazan: se busca con `flyctl machine list --app tcg-pocket`. **Simulaciones con el motor nuevo:** los puntajes del laboratorio de los 25 mazos armados (trabajos 72–74) y la matriz 42×42 (trabajo 75, f4 contra e4, la misma configuración que la 59). Los relanzados primero (68–71) armaron las fotos de los mazos con el estado de cartas de la Ryzen, y sus puntajes no se ven en los mazos ([H-059](Hallazgos/H-059.md)).

**Repo:** `santiqwerty1/tcg-pocket` es público desde el 11/10 ([D-022](Decisiones/D-022.md)). main está protegida (privacy, test, e2e y screens requeridos) y, desde el 18/10, con `enforce_admins`: tampoco la cuenta de Santiago empuja directo. El hub de chat vive en `santiqwerty1/chat-hub` (privado, [D-030](Decisiones/D-030.md)), con la CI en un runner propio de la PC de Santiago.

**Permisos desde #132 (18/10, [D-021](Decisiones/D-021.md)):** `git push` a una rama de PR no pide confirmación; main, forzar y borrar sí.

**Flujo desde el 13/10** (`docs/REVISION.md`): autorrevisión antes de cada PR, decisiones pendientes sin número (las numera `pnpm decisiones` al integrar, en el orden en que entraron), revisión según el riesgo, sesiones que rotan, y a Santiago se le escribe solo para decidir o hacer algo. **Deploys desde una copia limpia de main:** Posta deja relevos sin commitear en `Boveda/Sesiones/`.

**Turno de e2e desde el 15/10:** un solo e2e o build pesado a la vez entre todas las sesiones, anunciado en el chat con «e2e: arranco» y «e2e: listo», y vitest con `--maxWorkers=2`. WSL tiene un tope de 6 GB de memoria en `.wslconfig`, aprobado por Santiago. La CI del hub y la de Posta corren en esta PC, así que también usan el turno.

Lo que sigue, en orden:

1. **Bots, #128 (g 1.1, [T-021](Tareas/T-021.md), [H-055](Hallazgos/H-055.md)):** el cruce que falla en la corrida del banco bloquea. Entra cuando el banco corra entero sin fallas con la cabeza final, con esos números en el PR, y después de la verificación del delta que hace el Coordinador. Lo que Codex abra para modelar algo nuevo de una carta va a la deuda de `docs/BOTS.md`; los pánicos y las filtraciones de lo oculto se arreglan siempre. Después:
   - el PR del fork `perf/value-function-skips-zero-weights`, con el diferencial de Infra (`AFFECTED` vacía, dos semillas);
   - volver a medir los mazos 16, 23 y 40 con el motor nuevo;
   - el PR «la app acepta g», con su calibración, para que Santiago decida el bot por defecto;
   - la línea 2, sin trampa.
2. **Con el motor nuevo:** avisar los resultados de los trabajos 72–75, y que Santiago lance desde la app las calibraciones e2, e3 y MCTS. La calibración vuelve a jugar el cruce que fallaba en la #27 ([H-052](Hallazgos/H-052.md)).
3. **Infra, [H-059](Hallazgos/H-059.md):** que las fotos de los mazos no se armen con el estado de cartas de un worker viejo después de mover el motor (riesgo medio).
4. **Importar partidas desde la hoja de Santiago:** en una sesión nueva, con el diseño del Coordinador y las cuatro preguntas del traspaso de Principal del 18/10. Es de riesgo alto, porque escribe en masa.
5. **El hub ([D-030](Decisiones/D-030.md)):** T1b entró el 18/10 (#129). El paso 5 espera tres cosas: el paso 2 de Santiago (Supabase, Fly y secretos, con los comandos que prepara el Coordinador), el incremento 5 de Posta en su main (el 410 como «paro y aviso») y el token de conector «tcg-pocket (reenvío)» del hub como `HUB_MCP_TOKEN`. Después, el cambio de «posta», H4 y T2.
6. **Santiago:**
   - anotar Master Ball desde la partida 6 de ranked (las 26 del 17 y 18/10, ids 6 a 31): desde la edición de la partida, o en una conversación nueva con Claude, con `ranked_rank_note` ([T-022](Tareas/T-022.md));
   - lanzar las calibraciones e2, e3 y MCTS con el motor nuevo, desde Más → Simulación → Calibración;
   - el paso 2 del hub;
   - en la Ryzen, actualizar el worker (sigue en 0.2.7) y lo demás del paquete `tcg-ryzen-13oct-v2.zip`: el despachador de Codex-Revisor, el runner Windows de la CI de Posta y borrar sus runners viejos de tcg; además, decir si tiene WSL;
   - los 43 términos de las traducciones de los premios de las misiones, en su página;
   - Termux «Sin restricciones» en la batería del S25, y prenderlo: está apagado desde el 18/10 a las 10:16 ([H-054](Hallazgos/H-054.md), [T-015](Tareas/T-015.md));
   - en esta PC, el runner Windows de la CI de Posta.
7. **deckgym upstream:** bcollazo/deckgym-core#420 (el objetivo de Quick-Grow Extract y Wallace) espera al autor. El 15/10 cerró el issue #399 diciendo que en el juego no se elige y pidió un video; Santiago grabó los dos (Extracto y Plubio) el 16/10, y el autor no contestó después. #383 entró upstream, y #396–#398 los arregló el autor en sus PR #400 y #401.
8. **Privacidad del mail en GitHub** (recomendación para Santiago): activar «Keep my email addresses private» y «Block command line pushes that expose my email» ([R-013](Riesgos/R-013.md)).
9. **Menores:** [T-016](Tareas/T-016.md) sigue para cuando Santiago lo pida.

Hechos desde la actualización del 14/10:
- 15/10: #109 («Actualizar todos»), #110 (seguimiento del regulador), #111 (diseño del bot «g»), #113 (seguimiento de #107) y #115 (el fork de deckgym, [H-056](Hallazgos/H-056.md) resuelto), con tres deploys; chat-hub #7 (H6);
- 18/10: #114 y #120 ([T-022](Tareas/T-022.md) hecha), #116 ([H-058](Hallazgos/H-058.md)), #117 (el bot «g»), #118 y #121 (deuda del laboratorio), #119, #122 y #124 (el aviso de punto ciego, [H-055](Hallazgos/H-055.md)), #123 y #126 (T1a del hub) y #125, con seis deploys; chat-hub #8–#11 (H6.8 y H5);
- la pausa general del 15/10 a las 17:05 al 18/10 a las 02:46, por el límite semanal de la cuenta;
- el diagnóstico de Dedenne ex y la aprobación del fork sobre `adfe505`;
- 18/10, por la tarde: #129 (T1b del hub), #130 y #131 (la deuda de ranked y de rivales) y #132 (permisos), con un deploy; `enforce_admins` en main; chat-hub #12 y #13; las cinco mejoras de la hoja de partidas de Santiago;
- 19/10: #133 (el motor nuevo, `0b510d1`), #134 (la prueba de ranked de medianoche) y #135 (`catalog-sync` dice qué usa), con el deploy de `83dcb40`, el sync del catálogo y las simulaciones relanzadas (trabajos 72–75, después de [H-059](Hallazgos/H-059.md)); el arquetipo de 20 rivales, para «mi meta».

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

---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-11'
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
| 38 | Operación y avisos | hecho 09/10 · desplegado en `52c87e3` · pendiente configurar UptimeRobot ([P-011](Preguntas/P-011.md)) | 37 | [T-014](Tareas/T-014.md) |
| 39 | Copia fuera de Supabase y retención ([P-007](Preguntas/P-007.md): en la nube) | código hecho 09/10 · desplegado en `52c87e3` · pendiente bucket de Tigris, primera subida y primera limpieza con el OK de Santi | 38 | [T-014](Tareas/T-014.md) |
| 40 | Día de expansión en dos toques | hecho 09/10 (#31, DECISIONES 43.1–43.8) · desplegado en `52c87e3` · [H-004](Hallazgos/H-004.md) resuelto | 39 | [T-014](Tareas/T-014.md) |
| 41 | Interfaz | hecho 09/10 (Nube-Mejoras, DECISIONES 44.1–44.11) · desplegado (`773ad00`) · [P-012](Preguntas/P-012.md): un 401 conserva el service worker | 40 | [T-014](Tareas/T-014.md) |
| 42 | Simulaciones más baratas y calibradas | en curso · informe de calibración #29 y optimize con semillas comunes y confirmación #32 hechos ([H-011](Hallazgos/H-011.md) resuelto), junto a capacidades, perGame y lotes · 11/10: seguimiento de la calibración #44, partidas por peso y confirmación con e3 #49, carreras #53, worker que se actualiza solo #50 ([D-026](Decisiones/D-026.md)) y caché exacta de chunks (opción A) #46, en producción · falta reencolar al cambiar el motor (#48, rama `sim/engine-change`) y «dos chunks por worker / repetir los últimos» · [R-012](Riesgos/R-012.md) y [H-050](Hallazgos/H-050.md) abiertos | 41 | [T-014](Tareas/T-014.md) |
| 43 | Claude | hecho 09/10 · chat-puente #12 y seguimiento #34 integrados · desplegado en `52c87e3` · locks en deshacer/restaurar y marca transaccional para borrados «Sin terminar» | 42 | [T-014](Tareas/T-014.md), [R-010](Riesgos/R-010.md) |
| 44 | Análisis nuevos | hecho · parte 1 (44a–c) en #17, desplegada en `52c87e3` · parte 2 hecha 11/10 (Nube-Mejoras, DECISIONES 47.7–47.17) en #55, que reemplaza a #52: moneda pareja, «mi meta», Zona de Energía, robo con cartas que buscan, misiones en Sobres y «¿Qué armo después?» · en producción | 43 | [T-014](Tareas/T-014.md) |
| W | Más workers: nube, Android y navegador (reemplaza la 45, [P-008](Preguntas/P-008.md)) | en curso · Android adelantado por Santi: #38, #40, #41 y #43 (worker 0.2.8–0.2.11, [D-025](Decisiones/D-025.md)), con la prioridad baja de #39 · se actualizan solos desde 0.3.0 (#50, [D-026](Decisiones/D-026.md)): la PC ya pasó y faltan el Ryzen y el celu · falta el visto bueno en el teléfono · navegador: #57 cerrado por la mudanza, rama en el repo público · nube sin empezar | 44 | [T-015](Tareas/T-015.md) |
| A | Adelantar simulaciones desde la app; laboratorio, explorar y consistencia siempre antes | hecho 11/10 (#42, DECISIONES 50.1–50.4) · en producción | — | [T-018](Tareas/T-018.md), [D-024](Decisiones/D-024.md) |
| N | Análisis de todas las simulaciones (Más → Simulación → Análisis, tool `simulations_analysis`) | hecho 11/10 (#45, DECISIONES 52.1–52.7) · en producción · método propuesto, sin aprobar | — | [T-019](Tareas/T-019.md), [D-027](Decisiones/D-027.md) |
| C | Colección directo desde el tracker, sin CSV | hecho 11/10 (#56, DECISIONES 54.1–54.11) · en producción · falta el secreto `TRACKER_COLLECTION_ANON_KEY` · la automática, apagada hasta que Santi pruebe a mano · método propuesto, sin aprobar | — | [T-020](Tareas/T-020.md), [D-028](Decisiones/D-028.md) |
| M | Mudanza a repo público: historia completa reescrita y PR recreados | hecho 11/10 · `santiqwerty1/tcg-pocket` público (main `abd5034`) y el privado, archivado como `tcg-pocket-historial` · CI en los runners de GitHub · tag `v1.0.0` y release, los crea el Coordinador ([P-013](Preguntas/P-013.md)) | — | [D-022](Decisiones/D-022.md), [D-023](Decisiones/D-023.md) |
| L | Búsqueda del laboratorio: probar siempre los cambios obvios (+1 copia, paso hacia la lista de torneo) | pendiente, para cuando Santiago la pida | — | [T-016](Tareas/T-016.md) |
| O | Optimización de mazos: análisis del 09/10 (bot que no evoluciona, velocidad, semillas, búsqueda) | T-017 en curso · #5, #15, #20, #22, #25, #27 y #28 integrados: bot f, aprendizaje/combo, explicaciones, frenar, deshacer, Energía y segundas listas del banco · revisión #35 integrada · 11/10: D4 (#47), partidas por peso y confirmación con e3 (#49) y carreras (#53) · faltan C3, A3, E3/E4 y C8; e2 sigue por defecto hasta comparar contra torneos | — | [Optimización](Optimizacion-2026-10-09.md), [T-017](Tareas/T-017.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · aprobado 08/10 | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

**Producción al 11/10/2026:** el contenido de `9f934fc` del repo viejo, que es `abd5034` en el público. Incluye todo lo integrado hasta #46; no se redesplegó después de la mudanza. engine-cli 0.3.4. La PC corre el worker portable, que se actualiza solo desde la app ([D-026](Decisiones/D-026.md)). Las fases 0–8 y 22–35 conservan los vistos buenos ya registrados; integrar y desplegar no agrega aprobaciones nuevas.

**Repo:** `santiqwerty1/tcg-pocket` es público desde el 11/10 ([D-022](Decisiones/D-022.md)). El privado viejo es `santiqwerty1/tcg-pocket-historial`, archivado: no se le sube nada. Nada de datos personales en commits, PR, issues ni la bóveda. La CI corre en los runners de GitHub ([D-023](Decisiones/D-023.md)).

Después de la mudanza, las sesiones retoman de a una y avisan al Coordinador antes de abrir cada PR:

1. **Tag `v1.0.0` y release** con las fases 0 a 44, sobre main, después de integrar esta actualización de la bóveda. Los crea el Coordinador y la versión del worker no se toca ([P-013](Preguntas/P-013.md)).
2. **Sesiones de la nube:** las viejas («Mejoras y agregados de app» y «Nube 2») quedaron atadas al repo renombrado y se archivan. Se abren nuevas sobre el repo público cuando haya trabajo para la nube ([D-021](Decisiones/D-021.md)).
3. **Infra**, en este orden:
   - H-051: el bot «et» no se puede jugar, porque deckgym no reconoce ese código. Se arregla en engine-cli 0.3.5, con una feature del motor para que solo lo tomen los workers capaces. Ya está avisado upstream, en bcollazo/deckgym-core#396.
   - #48, reencolar al cambiar el motor, con los puntos de su revisión (rama `sim/engine-change`).
   - Los menores de #44.
   - «Repetir los últimos», con la pregunta de diseño abierta ([T-014](Tareas/T-014.md), fase 42).
4. **Worker del navegador:** retomar #57 con una sesión de la nube nueva (rama `ccr-7bc862a5-gmkv17`, [T-015](Tareas/T-015.md)).
5. **Principal:** `--setup --keep` del worker, un setup sin preguntas, y escribir la carpeta Inicio desde una app empaquetada ([D-026](Decisiones/D-026.md)).
6. **Laboratorio:** E3/E4 (borrador en `lab/e3e4`), los dos menores de #47 y los dos riesgos bajos de la confirmación con e3. Después, C3, A3 y C8 ([T-017](Tareas/T-017.md)).
7. **El Ryzen, el martes 13/10, con Santi ahí:**
   - Docker al iniciar, Postgres nativo en el puerto 5433 y `git config core.longpaths true`;
   - el worker nuevo, que se actualiza solo (D-026);
   - borrar la carpeta y el lanzador de Inicio de sus runners viejos, que ya se dieron de baja ([D-023](Decisiones/D-023.md), `docs/OPERACION.md`).
8. **El celu:** pasarlo a 0.3.x con el comando del instalador, una vez. Ahí se elige el nombre. Santi le activa los bots lentos al «S25» (`allowSlowBots: true`), porque en la cola solo quedan MCTS y profundidad 3–4 ([D-025](Decisiones/D-025.md)).
9. **Colección desde el tracker:**
   - cargar el secreto `TRACKER_COLLECTION_ANON_KEY` en Fly;
   - Santi prueba la sincronización a mano desde Colección y, si el diff se ve bien, el Coordinador prende la automática ([T-020](Tareas/T-020.md), [D-028](Decisiones/D-028.md)).
10. **Aprobar o no** [D-027](Decisiones/D-027.md) (método del análisis) y [D-028](Decisiones/D-028.md) (tracker). Están integradas, pero siguen como propuestas.
11. **CI de Posta:** un runner Linux en WSL, con la etiqueta `posta-linux`, para el repo de Posta (privado). Santi lo confirmó para después de la mudanza; no es de este repo.
12. **Dependabot:** volver las actualizaciones de versión a 2 y 1 (`.github/dependabot.yml`). Las alertas y los arreglos de seguridad ya están prendidos ([D-023](Decisiones/D-023.md)).
13. **Fase 39 en producción:** crear el bucket de Tigris y verificar la primera subida. La primera limpieza va con el OK de Santi ([P-010](Preguntas/P-010.md), [R-006](Riesgos/R-006.md)).
14. **Fase 38:** configurar UptimeRobot. La cuenta la crea Santi y los pasos están en `docs/OPERACION.md` ([P-011](Preguntas/P-011.md), [R-011](Riesgos/R-011.md)).
15. **Calibración:** comparar e2 y f2 con el mismo banco y registrarlo antes de cambiar el bot por defecto ([R-012](Riesgos/R-012.md), [P-009](Preguntas/P-009.md)). [T-016](Tareas/T-016.md) sigue para cuando Santi lo pida.

Todo entra por PR, con la CI verde y la revisión del Coordinador. Las sesiones se hablan por el chat externo al repo. La actualización compartida del 11/10 la hizo una sesión delegada en su worktree; el Coordinador la revisa e integra.

## Pendiente de decidir (para después)

Decididas por Santiago el 08/10/2026: D-007, D-008, D-009, D-011, D-012, D-013, D-014, D-015, D-016, D-017, D-018 y D-019 (ver cada ficha). El 09/10/2026: [D-020](Decisiones/D-020.md), y respondidas [P-006](Preguntas/P-006.md) (máximo 3 energías), [P-007](Preguntas/P-007.md) (copia en la nube) y [P-008](Preguntas/P-008.md) (las tres opciones, en [T-015](Tareas/T-015.md)).

El 11/10/2026:
- **Decididas por Santiago:**
  - [D-024](Decisiones/D-024.md): «Las cortas siempre primero»;
  - [D-026](Decisiones/D-026.md): los workers se actualizan solos, confiando en el servidor;
  - el cambio de [D-022](Decisiones/D-022.md): la historia completa;
  - y respondida [P-013](Preguntas/P-013.md): tag y release, sí.
- **Decidida por el Coordinador** e informada a Santiago: [D-025](Decisiones/D-025.md).
- **Esperan aprobación:** [D-027](Decisiones/D-027.md) y [D-028](Decisiones/D-028.md).

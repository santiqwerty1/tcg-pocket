---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-12'
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
| 38 | Operación y avisos | hecho 09/10 · desplegado en `52c87e3` · pendiente configurar UptimeRobot ([P-011](Preguntas/P-011.md)) | 37 | [T-014](Tareas/T-014.md) |
| 39 | Copia fuera de Supabase y retención ([P-007](Preguntas/P-007.md): en la nube) | hecho 09/10 · desplegado en `52c87e3` · en producción el 12/10, con el OK de Santi: bucket `tcg-pocket-backups` en Tigris, primera limpieza (5.730 repeticiones, 39,1 MB) y `RETENTION_CRON=true` (DECISIONES 42.7, [P-010](Preguntas/P-010.md) cerrada) · falta registrar la primera subida buena ([R-006](Riesgos/R-006.md)) | 38 | [T-014](Tareas/T-014.md) |
| 40 | Día de expansión en dos toques | hecho 09/10 (#31, DECISIONES 43.1–43.8) · desplegado en `52c87e3` · [H-004](Hallazgos/H-004.md) resuelto | 39 | [T-014](Tareas/T-014.md) |
| 41 | Interfaz | hecho 09/10 (Nube-Mejoras, DECISIONES 44.1–44.11) · desplegado (`773ad00`) · [P-012](Preguntas/P-012.md): un 401 conserva el service worker | 40 | [T-014](Tareas/T-014.md) |
| 42 | Simulaciones más baratas y calibradas | en curso · informe de calibración #29 y optimize con semillas comunes y confirmación #32 hechos ([H-011](Hallazgos/H-011.md) resuelto), junto a capacidades, perGame y lotes · 11/10: seguimiento de la calibración #44, partidas por peso y confirmación con e3 #49, carreras #53, worker que se actualiza solo #50 ([D-026](Decisiones/D-026.md)) y caché exacta de chunks (opción A) #46, en producción · 12/10: el bot «et» (#65, [H-051](Hallazgos/H-051.md) resuelto), menores de la calibración (#67), un solo motor por trabajo con `gamesRev` (#68, reemplaza a #48), «Reintentar lo que falló» (#71), «repetir los últimos» y `worker-timing` (#73 y #76), los CLI sin el arranque del servidor (#75) y la tool `simulations_calibration` (#77); en producción hasta #76, con #77 en curso · falta «dos lugares por worker», a decidir con los números de `worker-timing` · [R-012](Riesgos/R-012.md), [H-050](Hallazgos/H-050.md) y [H-052](Hallazgos/H-052.md) abiertos | 41 | [T-014](Tareas/T-014.md) |
| 43 | Claude | hecho 09/10 · chat-puente #12 y seguimiento #34 integrados · desplegado en `52c87e3` · locks en deshacer/restaurar y marca transaccional para borrados «Sin terminar» | 42 | [T-014](Tareas/T-014.md), [R-010](Riesgos/R-010.md) |
| 44 | Análisis nuevos | hecho · parte 1 (44a–c) en #17, desplegada en `52c87e3` · parte 2 hecha 11/10 (Nube-Mejoras, DECISIONES 47.7–47.17) en #55, que reemplaza a #52: moneda pareja, «mi meta», Zona de Energía, robo con cartas que buscan, misiones en Sobres y «¿Qué armo después?» · en producción | 43 | [T-014](Tareas/T-014.md) |
| W | Más workers: nube, Android y navegador (reemplaza la 45, [P-008](Preguntas/P-008.md)) | en curso · Android adelantado por Santi: #38, #40, #41 y #43 (worker 0.2.8–0.2.11, [D-025](Decisiones/D-025.md)), con la prioridad baja de #39 · se actualizan solos desde 0.3.0 (#50, [D-026](Decisiones/D-026.md)): la PC y el celu ya pasaron, falta el Ryzen (13/10) · 12/10: worker 0.3.2 (`--setup --keep`, #63), 0.3.3 (`gamesRev`, #68), 0.3.4 (el resultado perdido no gasta el chunk, con pausa visible, #72, [H-054](Hallazgos/H-054.md)) y 0.3.5 (un push por pausa, #74) · falta que Santi ponga Termux «Sin restricciones» en la batería y el visto bueno en el teléfono · navegador: #57 cerrado por la mudanza, rama en el repo público · nube sin empezar | 44 | [T-015](Tareas/T-015.md) |
| A | Adelantar simulaciones desde la app; laboratorio, explorar y consistencia siempre antes | hecho 11/10 (#42, DECISIONES 50.1–50.4) · en producción | — | [T-018](Tareas/T-018.md), [D-024](Decisiones/D-024.md) |
| N | Análisis de todas las simulaciones (Más → Simulación → Análisis, tool `simulations_analysis`) | hecho 11/10 (#45, DECISIONES 52.1–52.7) · en producción · método propuesto, sin aprobar | — | [T-019](Tareas/T-019.md), [D-027](Decisiones/D-027.md) |
| C | Colección directo desde el tracker, sin CSV | hecho 11/10 (#56, DECISIONES 54.1–54.11) · en producción · secreto `TRACKER_COLLECTION_ANON_KEY` cargado en Fly antes del deploy de `e08e502` · la automática, apagada hasta que Santi pruebe a mano · método propuesto, sin aprobar | — | [T-020](Tareas/T-020.md), [D-028](Decisiones/D-028.md) |
| M | Mudanza a repo público: historia completa reescrita y PR recreados | hecho 11/10 · `santiqwerty1/tcg-pocket` público (main `abd5034`) y el privado, archivado como `tcg-pocket-historial` · CI en los runners de GitHub · tag `v1.0.0` y release «TCG Pocket 1.0.0» en `2fd579e`, el commit de #62, que pasa los `package.json` a 1.0.0 ([P-013](Preguntas/P-013.md) cerrada, DECISIONES 41.19) | — | [D-022](Decisiones/D-022.md), [D-023](Decisiones/D-023.md) |
| L | Búsqueda del laboratorio: probar siempre los cambios obvios (+1 copia, paso hacia la lista de torneo) | pendiente, para cuando Santiago la pida | — | [T-016](Tareas/T-016.md) |
| O | Optimización de mazos: análisis del 09/10 (bot que no evoluciona, velocidad, semillas, búsqueda) | T-017 en curso · #5, #15, #20, #22, #25, #27 y #28 integrados: bot f, aprendizaje/combo, explicaciones, frenar, deshacer, Energía y segundas listas del banco · revisión #35 integrada · 11/10: D4 (#47), partidas por peso y confirmación con e3 (#49) y carreras (#53) · 12/10: E3/E4 y lo que quedaba de #47 y #49 (#64, DECISIONES 40.26–40.27) · faltan C3, A3 y C8; e2 sigue por defecto hasta comparar contra torneos con `simulations_calibration` (#77) | — | [Optimización](Optimizacion-2026-10-09.md), [T-017](Tareas/T-017.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · aprobado 08/10 | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

**Producción al 12/10/2026:** desplegada sucesivamente durante el día hasta `b0c3627` (#77). Versión 1.0.0, engine-cli 0.3.6 y worker 0.3.5; los workers se actualizan solos desde la app ([D-026](Decisiones/D-026.md)). La Fase 39 ya corre en producción. Las fases 0–8 y 22–35 conservan los vistos buenos ya registrados; integrar y desplegar no agrega aprobaciones nuevas.

**Repo:** `santiqwerty1/tcg-pocket` es público desde el 11/10 ([D-022](Decisiones/D-022.md)). El privado viejo es `santiqwerty1/tcg-pocket-historial`, archivado: no se le sube nada. Nada de datos personales en commits, PR, issues ni la bóveda. La CI corre en los runners de GitHub ([D-023](Decisiones/D-023.md)).

Las sesiones avisan al Coordinador antes de abrir cada PR. Lo que sigue, en orden:

1. **Después del deploy de #77:**
   - correr `worker-timing --days 7` (`node /app/apps/api/dist/cli/worker-timing.js --days 7`) y pasarle los números al Coordinador. Con ellos se decide «dos lugares por worker», lo último de la fase 42 ([T-014](Tareas/T-014.md));
   - el informe `Calibracion-2026-10-12.md`, en otro PR, con la tool `simulations_calibration`: la comparación de e2 y f2 contra torneos, escrita antes de cambiar el bot por defecto ([R-012](Riesgos/R-012.md), [P-009](Preguntas/P-009.md)).
2. **Calibraciones:** #35 (f4) completa su cruce fallado con «Reintentar lo que falló». #27 tiene un cruce que falla siempre hasta que deckgym arregle bcollazo/deckgym-core#398 ([H-052](Hallazgos/H-052.md)).
3. **El Ryzen, el martes 13/10, con Santi ahí:**
   - Docker al iniciar, Postgres nativo en el puerto 5433 y `git config core.longpaths true`;
   - el worker nuevo, que se actualiza solo: el paquete nuevo en otra carpeta y doble clic, o `tcg-worker.exe --setup --keep` si ya tiene config.json ([D-026](Decisiones/D-026.md));
   - borrar la carpeta y el lanzador de Inicio de sus runners viejos, que ya se dieron de baja ([D-023](Decisiones/D-023.md), `docs/OPERACION.md`).
4. **El celu («S25»):** Santi pone Termux en «Sin restricciones» en la batería, porque Android o la batería de Samsung le cortaron el motor a mitad de cruces largos ([H-054](Hallazgos/H-054.md)). Ya se actualiza solo y tiene los bots lentos activados ([D-025](Decisiones/D-025.md)).
5. **Fase 39:** registrar la primera subida buena al bucket (`backup.offsite` en `/api/ops/status`, o el aviso `backup_offsite` si falla). Con ella, proponer dar por resuelto [R-006](Riesgos/R-006.md).
6. **deckgym upstream:** seguir bcollazo/deckgym-core#396, #397 y #398. Al actualizar deckgym con los arreglos: sacarlos de `REPORTED_ENGINE_BUGS`, revisar la deduplicación de la mesa y rejugar el cruce de #27 ([H-051](Hallazgos/H-051.md), [H-052](Hallazgos/H-052.md)).
7. **Worker del navegador:** retomar #57 con una sesión de la nube nueva (rama `ccr-7bc862a5-gmkv17`, [T-015](Tareas/T-015.md)). Las sesiones de la nube viejas se archivaron ([D-021](Decisiones/D-021.md)).
8. **Laboratorio:** C3, A3 y C8 ([T-017](Tareas/T-017.md)).
9. **Colección desde el tracker:** Santi prueba la sincronización a mano desde Colección y, si el diff se ve bien, el Coordinador prende la automática ([T-020](Tareas/T-020.md), [D-028](Decisiones/D-028.md)).
10. **Aprobar o no** [D-027](Decisiones/D-027.md) (método del análisis) y [D-028](Decisiones/D-028.md) (tracker). Están integradas, pero siguen como propuestas.
11. **Privacidad del mail en GitHub** (recomendación para Santi): activar «Keep my email addresses private» y «Block command line pushes that expose my email». Antes de cada push, `git log --format='%h %ae %ce' origin/main..HEAD` muestra solo el noreply ([R-013](Riesgos/R-013.md)).
12. **Fase 38:** configurar UptimeRobot. La cuenta la crea Santi y los pasos están en `docs/OPERACION.md` ([P-011](Preguntas/P-011.md), [R-011](Riesgos/R-011.md)).
13. **Menores:**
    - [H-050](Hallazgos/H-050.md): «optimizar» no prueba dos copias de una misma candidata;
    - el pendiente bajo de #75: una sincronización del catálogo que muere a la fuerza queda «running» hasta el próximo reinicio de la API.
    - [T-016](Tareas/T-016.md) sigue para cuando Santi lo pida.

Hechos desde la actualización del 11/10: el tag `v1.0.0` ([P-013](Preguntas/P-013.md), cerrada), H-051 y #48 (que pasó a #68), los menores de #44, «repetir los últimos», `--setup --keep` (worker 0.3.2), E3/E4 del laboratorio, el runner de la CI de Posta en WSL (`posta-wsl-1`), Dependabot a 2 y 1 (#59–#61 integrados), y el bucket de Tigris con la primera limpieza.

Todo entra por PR, con la CI verde y la revisión del Coordinador. Las sesiones se hablan por el chat externo al repo. La actualización compartida del 12/10 la hizo una sesión delegada en su worktree; el Coordinador la revisa e integra.

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
- **Siguen esperando aprobación:** [D-027](Decisiones/D-027.md) y [D-028](Decisiones/D-028.md).

---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-10'
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
| 42 | Simulaciones más baratas y calibradas | en curso · informe de calibración #29 y optimize con semillas comunes y confirmación #32 hechos ([H-011](Hallazgos/H-011.md) resuelto), junto a capacidades, perGame, lotes y caché ya integrados · seguimiento de #29 preparado localmente por Infra, sin PR · [R-012](Riesgos/R-012.md) y [H-050](Hallazgos/H-050.md) abiertos | 41 | [T-014](Tareas/T-014.md) |
| 43 | Claude | hecho 09/10 · chat-puente #12 y seguimiento #34 integrados · desplegado en `52c87e3` · locks en deshacer/restaurar y marca transaccional para borrados «Sin terminar» | 42 | [T-014](Tareas/T-014.md), [R-010](Riesgos/R-010.md) |
| 44 | Análisis nuevos | parte 1 (44a–c) integrada en #17 y desplegada en `52c87e3`: núcleo, techs, 2 copias contra 1 y conversión al top 8 · resto pendiente | 43 | [T-014](Tareas/T-014.md) |
| W | Más workers: nube, Android y navegador (reemplaza la 45, [P-008](Preguntas/P-008.md)) | pendiente, después de la 44 | 44 | [T-015](Tareas/T-015.md) |
| L | Búsqueda del laboratorio: probar siempre los cambios obvios (+1 copia, paso hacia la lista de torneo) | pendiente, para cuando Santiago la pida | — | [T-016](Tareas/T-016.md) |
| O | Optimización de mazos: análisis del 09/10 (bot que no evoluciona, velocidad, semillas, búsqueda) | T-017 en curso · #5, #15, #20, #22, #25, #27 y #28 integrados: bot f, aprendizaje/combo, explicaciones, frenar, deshacer, Energía y segundas listas del banco · revisión #35 integrada · D4 y resto pendientes; e2 sigue por defecto hasta comparar contra torneos | — | [Optimización](Optimizacion-2026-10-09.md), [T-017](Tareas/T-017.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · aprobado 08/10 | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

**Producción al 10/10/2026:** `52c87e3`, desplegado por el Coordinador y verificado en `/healthz`. Worker 0.2.7 en la PC, engine-cli 0.3.3 con `perGame`, `batch` y `fairBots`. Las fases 0–8 y 22–35 conservan los vistos buenos ya registrados; integrar y desplegar no agrega aprobaciones nuevas.

1. **Modo mínimo hasta el domingo (11/10):** no abrir trabajo nuevo. El Coordinador revisa e integra; las sesiones atienden lo delegado ([D-021](Decisiones/D-021.md)).
2. **Fase 39 en producción:** crear el bucket de Tigris y verificar la primera subida; primera limpieza con el OK de Santi ([P-010](Preguntas/P-010.md), [R-006](Riesgos/R-006.md)).
3. **Fase 38:** configurar UptimeRobot; la cuenta la crea Santi y los pasos están en `docs/OPERACION.md` ([P-011](Preguntas/P-011.md), [R-011](Riesgos/R-011.md)).
4. **Infra:** seguimiento de #29 preparado localmente, sin PR; subirlo cuando lo indique el Coordinador. Después, comparar e2/f2 con el mismo banco y registrar la calibración antes de cambiar el bot por defecto ([R-012](Riesgos/R-012.md), [P-009](Preguntas/P-009.md)).
5. **Repo público:** ensayo de la mudanza hecho (#26), con 1.0.0 y numeración reservada. La ejecuta el Coordinador con el OK de Santi cuando no quede ningún PR abierto; al iniciar esta actualización quedan Dependabot #21, #23 y #24 ([D-022](Decisiones/D-022.md)). Retirar runners propios antes de publicar ([D-023](Decisiones/D-023.md)).
6. Al salir del modo mínimo, retomar el resto de la 42 y la 44 ([T-014](Tareas/T-014.md)) y de [T-017](Tareas/T-017.md), incluido D4. Después, los workers de [T-015](Tareas/T-015.md). [T-016](Tareas/T-016.md) sigue para cuando Santi lo pida.

Todo entra por PR, con la CI verde y la revisión del Coordinador. Las sesiones se hablan por el chat externo al repo. La actualización compartida de este día se delegó excepcionalmente a Codex en un PR; la revisión e integración siguen a cargo del Coordinador.

## Pendiente de decidir (para después)

Decididas por Santiago el 08/10/2026: D-007, D-008, D-009, D-011, D-012, D-013, D-014, D-015, D-016, D-017, D-018 y D-019 (ver cada ficha). El 09/10/2026: [D-020](Decisiones/D-020.md), y respondidas [P-006](Preguntas/P-006.md) (máximo 3 energías), [P-007](Preguntas/P-007.md) (copia en la nube) y [P-008](Preguntas/P-008.md) (las tres opciones, en [T-015](Tareas/T-015.md)).

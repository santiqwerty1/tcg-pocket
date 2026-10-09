---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-09'
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
| 37 | Números honestos | hecho 09/10 · desplegado (`e02c074`) · el punto 5 de [H-011](Hallazgos/H-011.md) pasó a Infra, con la 42 | 36 | [T-014](Tareas/T-014.md) |
| 38 | Operación y avisos | hecho 09/10 (Principal, PR #6 y #14; DECISIONES 41.1–41.12) | 37 | [T-014](Tareas/T-014.md) |
| 39 | Copia fuera de Supabase y retención ([P-007](Preguntas/P-007.md): en la nube) | hecho 09/10 (Principal, PR #19; DECISIONES 42.1–42.5) · en producción falta crear el bucket de Tigris, y la primera limpieza espera el OK de Santiago | 38 | [T-014](Tareas/T-014.md) |
| 40 | Día de expansión en dos toques | pendiente · Principal, después de la 39 y del ensayo de la mudanza al repo público | 39 | [T-014](Tareas/T-014.md) |
| 41 | Interfaz | hecho 09/10 (Nube-Mejoras, DECISIONES 44.1–44.11) · desplegado (`773ad00`) · [P-012](Preguntas/P-012.md): un 401 conserva el service worker | 40 | [T-014](Tareas/T-014.md) |
| 42 | Simulaciones más baratas y calibradas | en curso · en main: H-019, `perGame` (#3, #8), el reclamo rápido (#4), los lotes (#9), B3 (#10), la semilla por rival (#13), las capacidades del motor (#16) y 1 repetición por cruce (#18) · faltan la calibración (R-012), H-011.5 y el resto (Infra) | 41 | [T-014](Tareas/T-014.md) |
| 43 | Claude | hecho 09/10 · desplegado (`14e0c59`) · seguimiento de la revisión en main · el chat-puente sigue en el PR #12 | 42 | [T-014](Tareas/T-014.md), [R-010](Riesgos/R-010.md) |
| 44 | Análisis nuevos | en curso (Nube-Mejoras): techs, núcleo y conversión al top hechos en local | 43 | [T-014](Tareas/T-014.md) |
| W | Más workers: nube, Android y navegador (reemplaza la 45, [P-008](Preguntas/P-008.md)) | pendiente, después de la 44 | 44 | [T-015](Tareas/T-015.md) |
| L | Búsqueda del laboratorio: probar siempre los cambios obvios (+1 copia, paso hacia la lista de torneo) | pendiente, para cuando Santiago la pida | — | [T-016](Tareas/T-016.md) |
| O | Optimización de mazos: análisis del 09/10 (bot que no evoluciona, velocidad, semillas, búsqueda) | T-017 en curso (Laboratorio) · en main: H-010, H-020 y H-021, más la prueba apareada y el resumen por partida (#7) · en PR: bot `f<N>` (#5), aprendizaje entre rondas (#15), explicaciones (#20), «Frenar y confirmar» (#22) y deshacer cambios (#25) | — | [Optimización](Optimizacion-2026-10-09.md), [T-017](Tareas/T-017.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · aprobado 08/10 | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

Las fases 0–8 del plan están aprobadas (visto bueno de Santiago el 08/10/2026). Las fases 9 a 36 están desplegadas (las 25 a 35 en `0524489`, [T-013](Tareas/T-013.md); la 36 en `55d658d`); las 22 a 35 tienen su visto bueno del 09/10/2026.

1. Fases 36 a 44 de la [evaluación del 09/10](Evaluacion-2026-10-09.md) ([T-014](Tareas/T-014.md)), en el orden de [D-020](Decisiones/D-020.md) (decidido el 09/10/2026). Al empezar cada una, leer la nota «Verificación del 09/10» de sus hallazgos: corrige detalles de las fichas.
2. Después, los workers de [T-015](Tareas/T-015.md) (nube, Android y navegador), que reemplazan la fase 45.
3. Para después, cuando Santiago la pida: [T-016](Tareas/T-016.md) (variantes fijas en la búsqueda del laboratorio).

Desde el 09/10/2026 (tarde), por pedido de Santiago, trabaja así ([D-021](Decisiones/D-021.md)):

- **«TCG · Coordinador e integrador»:** reparte, revisa cada PR, mergea, despliega y opera. Es el único que toca los archivos compartidos de la bóveda.
- **«TCG · Principal»:** fases 38 y 39, en el worktree `tcg-pocket-ops`.
- **«TCG · Laboratorio»:** T-017 (bot corregido `f<N>`, PR #5) y el algoritmo del laboratorio.
- **«TCG · Infra de simulación»:** el resto de la 42, la calibración y H-011.5.
- **Nube-Mejoras:** la 41 (PR #1) y la 44.
- **Nube-2:** chat entre sesiones en el MCP, y después la 40.

Todo entra por PR, con la CI verde y la revisión del coordinador. Las sesiones se hablan por el chat de `C:/Users/<usuario>/Personal/tcg-pocket-chat/`, fuera del repo.

## Pendiente de decidir (para después)

Decididas por Santiago el 08/10/2026: D-007, D-008, D-009, D-011, D-012, D-013, D-014, D-015, D-016, D-017, D-018 y D-019 (ver cada ficha). El 09/10/2026: [D-020](Decisiones/D-020.md), y respondidas [P-006](Preguntas/P-006.md) (máximo 3 energías), [P-007](Preguntas/P-007.md) (copia en la nube) y [P-008](Preguntas/P-008.md) (las tres opciones, en [T-015](Tareas/T-015.md)).

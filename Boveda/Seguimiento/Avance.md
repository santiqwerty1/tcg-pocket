---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-08'
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
| 2 | Registro de partidas (M6) | hecho | 1 | `b7c4232` |
| 3 | Claude de solo lectura (MCP), mazo más cercano, aleatorio y mejores versiones | hecho | 2 | `5d081ed` |
| 4 | Sobres (M4) | hecho · aprobado 08/10 ([P-005](Preguntas/P-005.md)) | 3 | `2a266b6` |
| 4.1 | Tiempo limitado, «intercambiar» y versiones | hecho 07/10 · propuesto | 4 | [D-007](Decisiones/D-007.md), [D-008](Decisiones/D-008.md) |
| 5 | Torneos (M5) | hecho 08/10 · verificado en producción ([T-006](Tareas/T-006.md)) · aprobada al pedir la Fase 6 | 4 | [T-003](Tareas/T-003.md) |
| 6 | Simulación (M7) y worker de Windows | hecho 08/10 · desplegado · falta arrancar el worker con un token de producción ([T-007](Tareas/T-007.md)) y tu visto bueno | 5 | [T-004](Tareas/T-004.md) |
| 6.1 | Versión de torneo de cada mazo (pedido del 08/10) | hecho 08/10 · propuesto | 6 | [D-016](Decisiones/D-016.md) |
| 7 | Claude de escritura (M8 parte 2) | hecho 08/10 · falta probarla desde el celu ([T-009](Tareas/T-009.md)) y tu visto bueno | 6 | [D-017](Decisiones/D-017.md) |
| 7.1 | Laboratorio de mazos (pedido del 08/10) | hecho 08/10 · desplegado (`dc2dcad`) · falta tu visto bueno | 7 | [T-008](Tareas/T-008.md), [D-018](Decisiones/D-018.md) |
| 8 | Jugar contra un bot, consistencia, sustitutos, avisos y misiones | hecho 08/10 · probado en la demo · falta subir, desplegar y tu visto bueno | 7.1 | [T-011](Tareas/T-011.md), [D-019](Decisiones/D-019.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · propuesto | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

1. Probar la Fase 7 desde el celu ([T-009](Tareas/T-009.md)) y dar el visto bueno.
2. Probar el laboratorio de mazos en producción ([T-008](Tareas/T-008.md)) y revisar cómo mide y busca ([D-018](Decisiones/D-018.md)).
3. Probar la Fase 8 desde el celu ([T-011](Tareas/T-011.md)) y revisar [D-019](Decisiones/D-019.md).

## Pendiente de decidir (para después)

Decididas por Santiago el 08/10/2026: D-007, D-008, D-009, D-011, D-012, D-013, D-014, D-015, D-016, D-017 (ver cada ficha). Queda:

| Ficha | Qué falta | Mientras tanto |
|---|---|---|
| [T-009](Tareas/T-009.md) | Probar la Fase 7 desde el celu y Claude Code | probada en tests de integración |
| [T-008](Tareas/T-008.md) | Probar el laboratorio en producción | desplegado; probado en la demo con el motor real |
| [T-011](Tareas/T-011.md) | Probar la Fase 8 desde el celu | probada en la demo con el motor real |
| [D-019](Decisiones/D-019.md) | Cómo se juega contra el bot y cómo se mide la consistencia | implementado así |

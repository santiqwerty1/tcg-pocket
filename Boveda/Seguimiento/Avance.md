---
tipo: documento
titulo: >-
  Avance
area: proyecto
estado: vigente
actualizado: '2026-10-07'
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
| 4 | Sobres (M4) | hecho · falta tu visto bueno ([P-005](Preguntas/P-005.md)) | 3 | `2a266b6` |
| 4.1 | Tiempo limitado, «intercambiar» y versiones | hecho 07/10 · propuesto | 4 | [D-007](Decisiones/D-007.md), [D-008](Decisiones/D-008.md) |
| 5 | Torneos (M5) | pendiente | 4 | [T-003](Tareas/T-003.md) |
| 6 | Simulación (M7) y worker de Windows | pendiente | 5 | [T-004](Tareas/T-004.md) |
| 7 | Claude de escritura (M8 parte 2) | pendiente | 6 | [PLAN](../../docs/PLAN.md) |
| 8 | Jugar contra un bot, consistencia | abierto | 7 | [PLAN](../../docs/PLAN.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · propuesto | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

1. Visto bueno de la Fase 4 con sus ajustes del 07/10 ([P-005](Preguntas/P-005.md)).
2. Confirmar en el juego el último día del Deluxe Mega ([T-001](Tareas/T-001.md)).
3. Fase 5: torneos ([T-003](Tareas/T-003.md)).

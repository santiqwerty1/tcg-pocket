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
| 5 | Torneos (M5) | en curso desde 08/10 | 4 | [T-003](Tareas/T-003.md) |
| 6 | Simulación (M7) y worker de Windows | pendiente | 5 | [T-004](Tareas/T-004.md) |
| 7 | Claude de escritura (M8 parte 2) | pendiente | 6 | [PLAN](../../docs/PLAN.md) |
| 8 | Jugar contra un bot, consistencia | abierto | 7 | [PLAN](../../docs/PLAN.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · propuesto | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

1. Fase 5: torneos ([T-003](Tareas/T-003.md)).
2. Confirmar en el juego el último día del Deluxe Mega ([T-001](Tareas/T-001.md)) antes del 28/10.

## Pendiente de decidir (para después)

Registrado el 08/10/2026 a pedido de Santiago; todo con `revisar: true` (vista «Para revisar»).

| Ficha | Qué hay que decidir | Mientras tanto |
|---|---|---|
| [D-007](Decisiones/D-007.md) | Peso de los sobres por tiempo limitado (×2) y último día del B4b | aplicado como propuesta |
| [D-008](Decisiones/D-008.md) | Consejo «intercambiar» y puntos solo de expansiones a la venta | aplicado como propuesta |
| [D-009](Decisiones/D-009.md) | Activar hooks, reglas y CI de Posta | sin activar |
| [P-002](Preguntas/P-002.md) | Último día real del Deluxe Mega | 28/10/2026 |
| [P-003](Preguntas/P-003.md) | Costos de ✵ y ✵✵ | 1000 y 1350 sin verificar |
| [P-004](Preguntas/P-004.md) | Rarezas intercambiables | ◊ a ◊◊◊◊ y ☆ |
| [S-002](Supuestos/S-002.md) | Si los puntos de un sobre retirado se pueden seguir usando | se supone que no |

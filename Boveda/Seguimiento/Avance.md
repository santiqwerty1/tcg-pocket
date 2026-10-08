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
| 7 | Claude de escritura (M8 parte 2) | pendiente | 6 | [PLAN](../../docs/PLAN.md) |
| 8 | Jugar contra un bot, consistencia | abierto | 7 | [PLAN](../../docs/PLAN.md) |
| K | Bóveda con el kit de Posta | hecho 07/10 · propuesto | — | [D-009](Decisiones/D-009.md) |

## Próximos pasos

1. Arrancar el worker en la PC con un token de producción ([T-007](Tareas/T-007.md)) y correr la matriz de los 40 mazos allá.
2. Visto bueno de la Fase 6; después, Fase 7 (Claude de escritura).
3. Confirmar en el juego el último día del Deluxe Mega ([T-001](Tareas/T-001.md)) antes del 28/10.

## Pendiente de decidir (para después)

Registrado el 08/10/2026 a pedido de Santiago; todo con `revisar: true` (vista «Para revisar»).

| Ficha | Qué hay que decidir | Mientras tanto |
|---|---|---|
| [D-007](Decisiones/D-007.md) | Peso de los sobres por tiempo limitado (×2) y último día del B4b | aplicado como propuesta |
| [D-008](Decisiones/D-008.md) | Consejo «intercambiar» y puntos solo de expansiones a la venta | aplicado como propuesta |
| [D-009](Decisiones/D-009.md) | Activar hooks, reglas y CI de Posta | sin activar |
| [D-011](Decisiones/D-011.md) | Lista exacta sin ediciones; arquetipo de cada mazo sugerido | aplicado como propuesta |
| [D-012](Decisiones/D-012.md) | Backup sin los torneos de Limitless | aplicado como propuesta |
| [D-013](Decisiones/D-013.md) | engine-cli compilado en la PC; Actions de respaldo | aplicado como propuesta |
| [D-014](Decisiones/D-014.md) | Visor de repeticiones propio en texto | aplicado como propuesta |
| [D-015](Decisiones/D-015.md) | Backup sin simulaciones | aplicado como propuesta |
| [D-016](Decisiones/D-016.md) | Versión de torneo de cada mazo y Sobres apuntando a ella | aplicado como propuesta |
| [T-008](Tareas/T-008.md) | Laboratorio de mazos nuevos con Claude y el simulador: alcance y cuándo | después de la Fase 7 |
| [P-002](Preguntas/P-002.md) | Último día real del Deluxe Mega | 28/10/2026 |
| [P-003](Preguntas/P-003.md) | Costos de ✵ y ✵✵ | 1000 y 1350 sin verificar |
| [P-004](Preguntas/P-004.md) | Rarezas intercambiables | ◊ a ◊◊◊◊ y ☆ |
| [S-002](Supuestos/S-002.md) | Si los puntos de un sobre retirado se pueden seguir usando | se supone que no |

---
tipo: documento
titulo: >-
  Dónde vive cada cosa
area: sistema
estado: vigente
actualizado: '2026-10-07'
origen:
  - repositorio al 07/10/2026
revisar: false
---

# Dónde vive cada cosa

| Qué | Dónde | Quién lo cambia |
|---|---|---|
| Pedido original | [BRIEF](../../docs/BRIEF.md) | Santiago |
| Plan por fases, riesgos y preguntas de la Fase 0 | [PLAN](../../docs/PLAN.md) | Claude, con aprobación |
| Registro de decisiones de implementación (una línea de motivo) | [DECISIONES](../../docs/DECISIONES.md) | Claude |
| Decisiones, preguntas, supuestos, riesgos y tareas vivas | `Boveda/Seguimiento/` | los dos |
| Licencias y código tomado de las referencias | [LICENCIAS](../../docs/LICENCIAS.md) | Claude |
| Contrato REST, MCP y backup | [API](../../docs/API.md) | Claude |
| Estado, convenciones y comandos para Claude | [CLAUDE.md](../../CLAUDE.md) | Claude |
| Colección (CSV del 06/10) y los 40 mazos | `docs/context/` | Santiago |
| Fixtures e informes de la Fase 0 | `docs/fase0/` | — |
| Operación de producción | [Producción](../Operacion/Produccion.md) | Claude |

## Código

- `packages/domain`: lógica pura y testeada (catálogo, colección, mazos, partidas, sobres, MCP).
- `apps/api`: NestJS + Prisma (migraciones en `apps/api/prisma/migrations`).
- `apps/web`: PWA React en español.
- `refs/`: clones de solo lectura del tracker (GPL-3.0) y de deckgym-core (AGPL-3.0); no se versionan.

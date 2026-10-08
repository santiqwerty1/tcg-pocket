---
tipo: inicio
titulo: 'TCG Pocket'
area: proyecto
estado: vigente
actualizado: '2026-10-07'
origen:
  - posta init
revisar: false
---

# TCG Pocket

Bóveda del proyecto: el estado vivo está acá, no en las conversaciones. Si algo no coincide con
`git log` o con GitHub, mandan los comandos.

## Qué es

App personal de Pokémon TCG Pocket para un solo usuario (Santiago): colección, mazos, partidas, sobres y, más
adelante, torneos y simulación, con Claude como asistente por MCP. Producción en `https://tcg-pocket.fly.dev`.
Mapa de documentos y código: [Dónde vive cada cosa](Sistema/Mapa.md) · operación: [Producción](Operacion/Produccion.md).

## Hoy

- [Para revisar](Trabajo.base#Para%20revisar) · [Avance](Seguimiento/Avance.md) · última bitácora: [2026-10-07](Bitacora/2026-10-07.md)

![[Trabajo.base#Para revisar]]

<!-- posta:recuentos -->
_Recuentos al 2026-10-08 (generados; no editar a mano)._

| Tipo | Total | Por estado |
| --- | --- | --- |
| decision | 12 | propuesta 5 · vigente 7 |
| pregunta | 5 | cerrada 2 · parcial 1 · pendiente 2 |
| riesgo | 9 | abierto 9 |
| supuesto | 3 | por_validar 1 · verificado 2 |
| tarea | 6 | en_curso 1 · parcial 1 · pendiente 4 |

**Para revisar:** D-007, D-008, D-009, D-011, D-012, P-002, P-003, P-004, S-002. **Abiertas:** 24.
<!-- /posta:recuentos -->

## Fichas

- **Preguntas** (`P-NNN`): `Seguimiento/Preguntas/` · estados pendiente · parcial · respondida · cerrada
- **Supuestos** (`S-NNN`): `Seguimiento/Supuestos/` · estados por_validar · verificado · refutado
- **Decisiones** (`D-NNN`): `Seguimiento/Decisiones/` · estados propuesta · vigente · sustituida · descartada
- **Riesgos** (`R-NNN`): `Seguimiento/Riesgos/` · estados abierto · resuelto · descartado · por_revalidar
- **Hallazgos** (`H-NNN`): `Seguimiento/Hallazgos/` · estados abierto · resuelto · descartado · por_revalidar · sin_revisar_por_cuota
- **Tareas** (`T-NNN`): `Seguimiento/Tareas/` · estados pendiente · preparado · en_curso · bloqueado · parcial · hecho

Plantillas en `Plantillas/`; vistas en `Trabajo.base`. Cada ficha lleva `tipo`, `codigo`, `titulo`,
`area`, `estado`, `actualizado`, `origen` y `revisar`; la prioridad (1–5) exige `prioridad_origen`.

## Cómo trabajamos

- Al abrir: `posta relevo abrir` (qué cambió desde la última foto, qué espera).
- Al cerrar: `posta relevo cerrar --siguiente "acción exacta"`; la foto queda en `Sesiones/`.
- Antes de un PR: `posta check` sin errores. Los agentes proponen (`posta accion proponer`); la persona aprueba.

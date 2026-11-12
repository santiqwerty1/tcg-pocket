---
tipo: inicio
titulo: 'TCG Pocket'
area: proyecto
estado: vigente
actualizado: '2026-11-03'
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

- [Para revisar](Trabajo.base#Para%20revisar) · [Avance](Seguimiento/Avance.md) · última bitácora: [2026-11-03](Bitacora/2026-11-03.md)

![[Trabajo.base#Para revisar]]

<!-- posta:recuentos -->
_Recuentos al 2026-11-12 (generados; no editar a mano)._

| Tipo | Total | Por estado |
| --- | --- | --- |
| decision | 32 | vigente 32 |
| hallazgo | 33 | abierto 6 · resuelto 27 |
| pregunta | 15 | cerrada 8 · pendiente 2 · respondida 5 |
| riesgo | 14 | abierto 11 · resuelto 3 |
| supuesto | 3 | refutado 1 · verificado 2 |
| tarea | 25 | en_curso 5 · hecho 18 · parcial 1 · pendiente 1 |

**Para revisar:** P-015. **Abiertas:** 26 (prioridad 4–5: P-014, R-014).
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

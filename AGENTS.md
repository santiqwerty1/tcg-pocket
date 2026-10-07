# TCG Pocket — reglas para agentes

<!-- generado por posta: se regenera con `posta incorporar`; editá la copia, no esta -->

Este repositorio se trabaja entre una persona y agentes (Claude Code, Codex) con **Posta**: la
memoria del proyecto está en la bóveda `Boveda/` (fichas Markdown con frontmatter), no en las
conversaciones. La persona decide y mergea; los agentes implementan, revisan y **proponen**.

## Antes de empezar

1. Leé `Boveda/Inicio.md` y la última foto en `Boveda/Sesiones/` (o corré `posta relevo abrir`).
2. Si algo de la bóveda no coincide con `git log` o con GitHub, mandan los comandos: corregí la ficha.
3. Fichas tipadas: pregunta `P-NNN`, supuesto `S-NNN`, decisión `D-NNN`, riesgo `R-NNN`, hallazgo `H-NNN`,
   tarea `T-NNN`. Una por archivo, en `Boveda/Seguimiento/<Tipo>s/`, desde `Boveda/Plantillas/`.

## Mientras trabajás

- Citá los códigos en los commits y PRs: `fix(reporte): compara contra la base del evento (H-012)`.
- Commits chicos, en español, Conventional Commits. No toques `Boveda/Sesiones/`: lo genera Posta.
- Lo que requiere decisión de la persona va como ficha `propuesta` o `pendiente`, nunca como hecho.
- Nunca: mergear, desplegar, escribir en GitHub, mover datos reales al repositorio.
- Las aprobaciones no se ejecutan, se **proponen**: `posta accion proponer --tipo … --quien agente:<nombre>`.

## Al terminar

- `posta check` tiene que pasar sin errores. `posta relevo cerrar --siguiente "acción exacta"`.

## Límites declarados

Están en `.posta/config.json` (`reglas`); Claude Code los aplica en sus herramientas desde `.claude/settings.json` y el hook
`PreToolUse` de Posta los revisa sobre la forma canónica de cada comando y las rutas que menciona. Para Codex y cualquier otro
agente valen igual aunque nadie los imponga. El bloque lo mantiene `posta generar`:

<!-- posta:limites -->
- **No editar** (lo escribe Posta o la persona): `Boveda/Sesiones/**`, `.posta/eventos/**`.
- **Ni leer ni editar** (secretos): `.env`, `.env.local`, `.env.fly`, `~/.posta/claves/**`.
- **Pedir confirmación antes de correr**: `git push *`.
<!-- /posta:limites -->

## Reglas de review (Codex)

- Un comentario de review es una **hipótesis**: se verifica contra el código, idealmente con una
  prueba que falle antes del arreglo. Severidad `P0`–`P3` al principio del comentario.
- No abrir un hallazgo nuevo si ya existe uno con la misma huella (misma ruta y mismo texto):
  `posta hilos importar` lo enlaza.
- Al corregir: `posta hallazgo cerrar H-NNN --por <sha>` sólo cuando el commit está en `main`;
  la respuesta al hilo queda propuesta y la publica la persona.
- Si no se puede revisar por cuota, decirlo; Posta lo marca en «Hoy».

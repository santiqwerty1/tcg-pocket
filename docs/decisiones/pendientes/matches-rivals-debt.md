---
seccion: Rival por cartas vistas (14/10/2026)
---
| **«Deshacer» una clasificación es atómico** (deuda de #114): `POST /api/matches/classify/undo` devuelve cada partida a su rival en una sola transacción. Solo toca las que siguen con el rival que dejó la clasificación, y la nota del rival vuelve con ellas si se restauró alguna. Una partida borrada mientras tanto queda en `skipped` en vez de hacer fallar el grupo (`classify` igual). Mover la nota toma el mismo lock que escribir una nota. Sin partidas cambiadas, no hay «Deshacer». | Un «Deshacer» a medias dejaba mezcladas las partidas de un rival con dos escrituras. |

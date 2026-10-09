# Respuestas crudas de la API de Limitless (6/10/2026)

Capturadas con curl el 6/10/2026 para fijar fixtures de M5 sin volver a consumir la cuota (50 req / 5 min). Base: https://play.limitlesstcg.com/api. Los archivos .headers guardan los encabezados de respuesta (RateLimit).

Desde el 9/10/2026 (repo público, D-022), los standings y las rondas llevan **seudónimos**: cada jugador es «Jugador NNN» con id `jugador-NNN` (el mismo en standings y en rondas) y sin país (`scripts/pseudonymize-limitless.mjs`). Listas, récords, puestos y resultados quedan como los mandó Limitless.

| Archivo | Bytes | Contenido |
|---|---:|---|
| README.md | 325 | encabezados de la respuesta homónima |
| big.headers | 379 | encabezados de la respuesta homónima |
| big_details.json | 486 | GET /tournaments/6a95b87b629039f77d8a6954/details |
| big_pairings.json | 116644 | GET /tournaments/6a95b87b629039f77d8a6954/pairings (PMPT #45, 1.143 partidas; bajado el 8/10/2026, Fase 9) |
| big_pairings.headers | — | encabezados de la respuesta homónima |
| big_standings.json | 426614 | GET /tournaments/6a95b87b629039f77d8a6954/standings (PMPT #45, 393 jugadores) |
| decks.headers | 381 | encabezados de la respuesta homónima |
| decks_nokey.json | 20 | GET /games/POCKET/decks sin key (400 Invalid Access Key) |
| det.headers | 374 | encabezados de la respuesta homónima |
| fmt_noex.headers | 376 | encabezados de la respuesta homónima |
| fmt_noex.json | 9424 | GET /tournaments?game=POCKET&format=NOEX&limit=50 |
| fmt_std.headers | 369 | encabezados de la respuesta homónima |
| fmt_std.json | 2 | GET /tournaments?game=POCKET&format=STANDARD&limit=50 (devuelve []) |
| games.headers | 375 | encabezados de la respuesta homónima |
| games.json | 3645 | GET /games |
| lim500.headers | 378 | encabezados de la respuesta homónima |
| lim500.json | 91358 | GET /tournaments?game=POCKET&limit=500&page=3 |
| noex.headers | 378 | encabezados de la respuesta homónima |
| noex_pairings.json | 22884 | GET /tournaments/6a9ebbfcab080c8c957fcc9a/pairings (NOEX, 228 partidas; bajado el 8/10/2026, Fase 9) |
| noex_pairings.headers | — | encabezados de la respuesta homónima |
| noex_standings.json | 78862 | GET /tournaments/6a9ebbfcab080c8c957fcc9a/standings (NOEX, 79 jugadores) |
| t1.headers | 377 | encabezados de la respuesta homónima |
| t1.json | 36567 | GET /tournaments?game=POCKET&limit=200 (página 1) |
| t2.headers | 377 | encabezados de la respuesta homónima |
| t2.json | 36372 | GET /tournaments?game=POCKET&limit=200&page=2 |

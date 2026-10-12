# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El bloque siguiente lo mantiene Posta; el resto es de la persona.

## [Sin publicar]

<!-- posta:cambios -->
_Borrador generado al 2026-10-11 (97 commits). Escribí el «porqué» fuera de este bloque._

### Agregado

- the analysis tells the games copied from the cache apart (phase 42) (#45) `e97b9ea`
- muestra sincronización y ajustes del tracker (T-020) `11a520a`
- sincroniza colección con revisiones del tracker (T-020) `0a9cb61`
- adapta filas públicas al importador (T-020) `cdb85c6`
- carreras — a search round in two halves, the clearly worse variants out after the first (fase 42, T-017) `eaf5990`
- análisis de simulaciones con gráficos y comparación entre bots (T-019) (#45) (D-027) `0dc98a3`
- each rival's games by its weight, and a confirmed find replayed with e3 — «robusto» or «sensible al bot» (fase 42, T-017, R-012) `996b5ca`
- workers update themselves from the app's package, with a determinism check and rollback (D-026) (SHA-256) `36679ab`
- measure against the meta, «mi meta» or one rival (T-017 D4) `4a47f88`
- exact cache of chunks — a chunk that would play exactly what a finished one played takes its result (phase 42) `57214e7`
- excluye bots lentos en Android antes del lease (D-025, T-015) `a0fae41`
- permite adelantar trabajos activos (T-018) `45fbdcb`
- agrega apagado y accesos de Termux Widget (T-015) `12b04c8`
- cede CPU a la CI con prioridad configurable (D-023, T-015) `8de3d97`
- descarga por Bearer y guía de instalación en la app (T-015) `c72dec9`
- empaqueta Android y verifica determinismo y apagado (T-015) `017dfda`
- archetype núcleo, techs, two copies against one and top-8 conversion — phase 44, part 1 (T-014) (#17) `0b57be1`
- «¿Qué mazo armo después?» — per archetype, the closest tournament list and what finishing it costs (phase 44, T-014) `bb7bcbc`
- missions as a third goal of Sobres (phase 44, T-014) `7d26150`
- Energy Zone odds by turn and draw odds counting the search cards (phase 44, T-014) `85b4461`
- «mi meta» — my rivals as tournament archetypes, as weights for «¿Cuál llevo hoy?» and the deck sheet (phase 44, T-014) `d72ba3d`
- win share with the coin even — half going first, half going second (phase 44, T-014) `3d189fb`
- optimize plays every combination with the same seeds and confirms its best 3 with fresh ones (H-011, C8) `c2fb3ae`
- expansion day in two taps — sync repeats the loaded commit, update to the tracker's newest with a preview (diff, remap, engine), confirmation before taking cards away, proposed era-table rows (phase 40, H-004, H-006) `b2c0ebf`

### Corregido

- the determinism checks leave the build fingerprint out — it names the target, not the games (#46) `abd5034`
- a deck's energy types once each on write and read; 47.9 says D4 is still pending (phase 44, T-014) (#55, #47) `9c54548`
- independent review of #52 — «mi meta» by era and effective n, weights' error in expectedMine, coin orientative by side (phase 44, T-014) (#47) `28374f2`
- review of #52 — repeated energy types on the deck page, coin-adjusted hint with n and interval (phase 44, T-014) (T-017, #47) `6304f8f`
- any short cliVersion is taken; only the exact form is a source; compiler and target in the fingerprint (verification of #46) `41d04e2`
- review of #47 — «mi meta» in the bank's era, at least 10 effective matches, n effective, orientativo, matches per rival and weighted coverage (T-017 D4) `209eed2`
- only a result that names its build can be copied by the cache (review of #46) `7485df5`
- declara el tipo JSON del fixture tracker (T-020) `b1d6537`
- the exact cache keys on the engine that played, never breaks a job, keeps one copy of the replays (review of #46) `923e373`
- windows-update also on Dockerfile changes with its own tcg-worker.exe; setup stops the old worker's tree and reports a lock it cannot recognise (D-026) `0d37f7c`
- confirma revisiones y muestra la última comprobación (T-020) `a133b10`
- acota fotos y protege la sincronización automática (T-020) `c1a4a7a`
- rechaza colecciones vacías y respeta reintentos (T-020) `a348a0a`
- review of #47 — every score says what it was measured against, consistency refuses an objective, a search with one (T-017 D4) `1742c02`
- review of #50 — backoff for failed preparations, rollback after three tries, reproducible packages, CI runs the served engine (D-026) `e8c44d8`
- review of #53 — carreras off by default until measured, half weight for what left, nobody leaves when the incumbent missed a pairing (fase 42, T-017) `b6b2dbe`
- one calibration point per pair of archetypes, mixing their lists (review of #44, R-012) `49c56bc`
- review of #49 — three outcomes for the e3 replay, its games by weight and behind the rest, queued from the transaction or the sweep (fase 42, R-012) (D-024) `0f72c99`
- decks_next_build says what can be traded also when a copy has no point price (phase 44, T-014) (#52) `4740a0b`
- repeated energy types count once, the opening Active leaves the hand, unpriced copies can be traded (phase 44, T-014) (#52) `a276155`
- preserva trabajo ante fallas de motor y red (T-015) `f5814ea`
- protege trabajos cortos antes de prioridad (D-024, T-018) `a1583dd`
- pregunta y conserva el nombre en la app (T-015) `143c038`
- completa partidas y notifica los leases liberados (T-015) `d432d8a`
- permite apagar durante el arranque sin red (T-015) `b521900`
- calibration report with today's aliases, one point per list, split and cancelled pairings, cached list (follow-up of #29, R-012) `0d9e275`
- a «Sin terminar» deletion is undoable only if its delete committed (phase 43 follow-up, R-010) (#34) `1b78dad`
- review of #35 by Codex — combo caps from the frozen pool, chained combos undone in place (T-017) `13edeaf`
- restoring a match checks its id and clientRef after locking inserts (phase 43 follow-up, R-010) (#34) `1065c31`
- undoing a rival note takes the note's lock; restoring a match locks inserts into matches (phase 43 follow-up, R-010) `195ef7e`
- estabiliza tests bajo carga de runners (D-023) `582bca2`
- logging out by hand clears what was shared too; docs for phase 44 part 2 (T-014) (#1) `4703f37`
- review of the stack — no stacked combos, undo in place, fixed variants within the round, combos above the collection, «jugando», the pool follows the Energy Zone (T-017) `2a1ed66`
- optimize confirmation visible to Claude, only complete rows, never lost or doubled (review of #32, H-011) `66bb984`
- what the review bots found and the coordinator approved — f's clock, Frenar keeps a winner, learned changes and the bank size (T-017, H-018) (H-010) `c755499`
- retain failure logs and abandon attempts (T-014) `7bc08c3`
- release disconnected long-poll leases (T-014) `fc8b47a`
- «Aplicar» carries the preview's baseline and is refused if the catalog changed in between (phase 40) `a9115db`
- read the tracker's CardsDB literals with a data-only parser, never new Function — the expansion-day preview fetches unreviewed commits (phase 40) `4cd678d`
- review of the move plan — the private remote points to the renamed private repository, moved branches take the noreply author, numbers reserved on the empty repository with marker checks, --verify fails on problems, --force never on the repository (D-022) `736f335`
- review of phase 40 — the CLI repeats the loaded commit with the guard and --confirm, the configured engine by default, unknown comparison asks, apply on a new commit with the same cards, one preview per commit, download timeout `a391431`
- isolate game workers and await shutdown (T-014) `3b6e880`
- cancel claims when workers disconnect (T-014) `d8f65c1`

### Cambiado

- «mi meta» in the Laboratorio is fase 44's myMeta (T-017 D4, after #52) `ef8649a`

### Documentado

- the move to the public repository and what PRs #38-#56 left for the vault (D-022, D-023, P-013, T-015, T-017, T-018, T-019, T-020) (D-020, D-021, D-025, D-028, R-003, R-012, T-014, #42, #45, #56, D-027) `a3cb1ad`
- registra correcciones y operación de la clave (T-020, D-028) `3dec2c5`
- registra propuesta, backup y validación (T-020, D-028) `12c31af`
- registra aprobación y aplicación del filtro (D-025, T-015) `1748e92`
- propone filtro de bots antes del reclamo (D-025, T-015) `3d8819e`
- registra resiliencia y consultas pendientes (T-015) `1f23ce9`
- propone protección de trabajos cortos (D-024, T-018) `a9388e7`
- explica widgets y permisos de Termux (T-015) `f77a458`
- registra prioridad, operación y medición de 0.2.8 (D-023, T-015) `66c9a9f`
- registra operación, fuentes y límites de la prueba (T-015) `83cba56`
- actualiza lo integrado y los pendientes al 10/10 (D-021) `eab4c8d`
- regenerate indexes so D-023 is linked (D-023) `766644c`

### Pruebas

- pseudonymize the Limitless player left in a comment of lineFormat.test.ts (D-022) `620e3f5`
- the build-time budget is 6 s in CI and 2 s locally — the shared runners are slower under load (D-023) `800a7eb`
- 240 s for the 81-list matrix e2e — it times out at 60 s on the loaded PC runners and fails every PR (D-023) `7a3c4f9`
- actualiza aceptación de torneos a v8 (T-020) `32d374d`
- 42 read tools with main's simulations_analysis (phase 44, T-014) `85a98b7`
- 20 s per test in CI — the determinism gate and other process tests time out on the loaded PC runners (D-023) `c313a41`
- sincroniza la limpieza sin depender del reloj (T-015) `b8714e6`
- mide reparto de CPU y determinismo en Windows (D-023, T-015) `25ac7e1`
- the optimize confirmation test reuses the app that beforeAll already started — #32 and #33 each called listen (H-011, T-014) `a97beb0`
- verifica reclamos con workers 0.2.6 y 0.2.7 (T-014) `fc785c6`

### Mantenimiento

- runner scripts take -Repo and refuse a public repository; operation notes for the public repo (D-022, D-023) `9dff2ad`
- changes, test and engine can run on any PC runner (label tcg-light); Postgres and Docker jobs stay on tcg-pc (D-023) `88259f3`
- runner install takes a name prefix for a second PC and checks what the jobs need first (D-023) `ba2e522`
- engine-cli 0.3.3 — f's clock changes what the bots play, so cached chunks of 0.3.2 must not be reused (T-017) `36fd94c`
- engine-cli 0.3.2 — #5 took 0.3.1 first (H-011) `4e05834`
- the move to the public repository starts at 1.0.0 (versions, tag, release notes) and keeps the PR numbering (reserved issues); zero open PRs first (D-022) `d1cecae`
- rehearsal of the move to a new public repository — one-commit tree with the noreply author, checks, step-by-step plan (D-022) `27c0399`
<!-- /posta:cambios -->

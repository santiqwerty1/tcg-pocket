# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El bloque siguiente lo mantiene Posta; el resto es de la persona.

## [Sin publicar]

<!-- posta:cambios -->
_Borrador generado al 2026-10-10 (99 commits). Escribí el «porqué» fuera de este bloque._

### Agregado

- archetype núcleo, techs, two copies against one and top-8 conversion — phase 44, part 1 (T-014) (#17) `237479b`
- a whitelist of participants, a budget per read, the bridge notes its client (D-021) `b3099a9`
- the server chat is a bridge to the cloud sessions (D-021) `fad9a59`
- chat between the Claude sessions in the app's MCP (D-021) `20a75ae`
- Claude write log with undo, new MCP tools and leaner answers (phase 43, T-014, R-010) `af1265b`
- optimize plays every combination with the same seeds and confirms its best 3 with fresh ones (H-011, C8) `008beee`
- expansion day in two taps — sync repeats the loaded commit, update to the tracker's newest with a preview (diff, remap, engine), confirmation before taking cards away, proposed era-table rows (phase 40, H-004, H-006) `8ed4097`
- f<N> bots, an expectiminimax whose clock sees evolutions, by engine feature «fairBots» (H-018, T-017) (P-009) `010313c`
- calibration against tournaments — the meta bank played by a chosen bot next to the matchups (R-012) `9a40a72`
- the most played archetypes of the bank bring a second list that shares their weight (T-017) `84624af`
- energy variants — the same cards with another Energy Zone, one per round (T-017) (P-006) `b84d39e`
- one card per variant, and later rounds try undoing an earlier accepted change (T-017) `0ad8ab6`
- «Frenar y confirmar» ends a search's round with what it has and confirms what it found (T-017) `e7a8e14`
- each variant against the best of its round, why its cards came in, and what the search could not try (T-017) `4da0b67`
- daily cleanup of old replays with a dry run, the copy outside Supabase on Tigris, rebuild guide (phase 39, R-006, P-010) `163b21c`
- one replay per pairing in new matrices, two in comparisons (database size) (#4) `348fffd`
- engine features decide what a worker can play; work nobody can play is said (H-010, H-018) `1eba88a`
- what a search learns between rounds steers the next ones, and a combo of the two best swaps (T-017) `391e530`
- interface — phase 41 (T-014, P-012) (#1) `773ad00`
- in a comparison every deck plays each rival with the same seeds (H-020) `bfe8a4d`
- matrix chunks wait while a search prepares its next round (B3) (T-015) `bf7a371`
- several pairings of one job in one engine process (B2) `d49a602`
- operation alerts, /api/ops/status and system_status, memory limits, release_command, deploy verification (phase 38, WIP) `4004ce7`
- paired test on per-game results and what each list's games say (H-010, T-017) `d5a806b`
- honest numbers — luck per game, clustered intervals, FDR, Fisher, pack points (phase 37, H-009, H-011, H-012) `6af29d1`
- engine-cli exits right after its games and reports each game on request (H-019, H-010, T-017) `9a27fe6`

### Corregido

- a «Sin terminar» deletion is undoable only if its delete committed (phase 43 follow-up, R-010) (#34) `3675361`
- review of #35 by Codex — combo caps from the frozen pool, chained combos undone in place (T-017) `d70a410`
- restoring a match checks its id and clientRef after locking inserts (phase 43 follow-up, R-010) (#34) `8318df9`
- undoing a rival note takes the note's lock; restoring a match locks inserts into matches (phase 43 follow-up, R-010) `ffcb7b5`
- Santi anchored to owner, ASCII names, ref conflicts refused, new sessions start after the history (D-021) (#12) `59c9234`
- old rival-note undo entries touch only their note; the drill's fallback relocks the tables (phase 43 follow-up, R-010) `03c5f28`
- estabiliza tests bajo carga de runners (D-023) `3324682`
- a relay retry is found before the list is checked; the bridge adds participants create-only (D-021) `b20b974`
- a rival-note undo also checks the note's version, not only its text (phase 43 follow-up, R-010) `1c5df4f`
- rival notes locked by key even before they exist, label-only writes undoable, no stale collection chain (phase 43 follow-up, R-010) `583df5e`
- a match deletion left «Sin terminar» can still be undone (phase 43 follow-up, R-010) `944a5f7`
- a session that only read is known; the retention clean-up never fails a send (D-021) `92f038d`
- atomic rival-note undo with its archetype, drill sequences under a lock, client cap per token lock (phase 43 follow-up, R-010) `437519f`
- a seen set instead of a read watermark; recipients validated one by one (D-021) `5ebf22b`
- sequences never move back, chained collection undo, undoable rival notes (phase 43 follow-up, R-010) `f2cb594`
- review of the stack — no stacked combos, undo in place, fixed variants within the round, combos above the collection, «jugando», the pool follows the Energy Zone (T-017) `b74e31f`
- optimize confirmation visible to Claude, only complete rows, never lost or doubled (review of #32, H-011) `ec934f2`
- atomic collection undo, versioned match delete, bounded token clients (phase 43, R-010) `53784cb`
- what the review bots found and the coordinator approved — f's clock, Frenar keeps a winner, learned changes and the bank size (T-017, H-018) (H-010) `e0f577f`
- audit entry before the write, no duplicate restore, versioned collection undo (phase 43, R-010) `14e0c59`
- retain failure logs and abandon attempts (T-014) `0988ebb`
- release disconnected long-poll leases (T-014) `c57e913`
- «Aplicar» carries the preview's baseline and is refused if the catalog changed in between (phase 40) `7c9a34e`
- read the tracker's CardsDB literals with a data-only parser, never new Function — the expansion-day preview fetches unreviewed commits (phase 40) `2076173`
- review of the move plan — the private remote points to the renamed private repository, moved branches take the noreply author, numbers reserved on the empty repository with marker checks, --verify fails on problems, --force never on the repository (D-022) `ba45ea8`
- review of phase 40 — the CLI repeats the loaded commit with the guard and --confirm, the configured engine by default, unknown comparison asks, apply on a new commit with the same cards, one preview per commit, download timeout `12a339c`
- review of #29 — compatible with both errors, Spearman both ways with a bootstrap, archetypes over the same rivals with n and interval, failed pairings apart `8766e8d`
- isolate game workers and await shutdown (T-014) `ac1def5`
- cancel claims when workers disconnect (T-014) `4650462`
- review of #22 — the next round starts after the stopped one, a verification in play finishes, no stuck search (T-017) `bb12fc1`
- review of #20 — the difference shown is the verification's, only on complete rounds; explanations in their own module (T-017) `0efcece`
- review of #15 — typed test, combos within the copies and by what was learned, complete rounds only (T-017) `edb3d45`
- review of phase 39 — cleanup off until RETENTION_CRON and a CLI dry run, virtual-hosted Tigris URLs with Content-MD5, archived replays kept a week (one per pairing), separate failure states, pruning by date, monthly check of the bucket copy `22302b2`
- a failure in a batch is its pairing's only; a broken batch is played chunk by chunk (review of #9) `97cf1ac`
- turnLimit is an integer from 1 to 100; the alert names its oldest job; negative tests (review of #16) `61050bf`
- review of phase 38 — one push per 50 MB step, a failed migration never keeps the app down, Limitless alert by day, majors apart in Dependabot, situations cache of 64, stale datasets leave memory `90cb692`
- review of #7 — perGame decided round by round, a sweep, partial pairing, rates with intervals (H-010, T-017) `2d3aa73`
- ask for perGame only when a worker's engine-cli plays it too (H-010) (#7, #8) `de71216`
- a result that does not add up fails the chunk; perGame needs engine-cli 0.2.0 (H-010) (#3) `b5e241c`
- verify a round's winner on fresh seeds and let the confirmation decide (H-010) (H-020, H-021) `5e394fc`
- a search plays the plan it showed and keeps its inputs for every round (H-021) `a6c40e6`
- build each round's variants from the incumbent's lines in order (H-020) `3a7bb81`
- variants keep every other card in its place so common seeds compare the swap (H-020) `0abb5f4`

### Cambiado

- perGameReady uses the queue's canPlayPerGame (engine features, #16) (H-010) `de3ab51`
- a claim counts each job's pending chunks once (B2, H-019) `d39a89b`
- one bot-code pattern for every schema (H-018) `ce80e50`

### Documentado

- regenerate indexes so D-023 is linked (D-023) `5501f0c`
- PRs #9, #10, #13 and #19 and the phase 43 follow-up integrated (T-014, R-006, P-007, R-010) `3643df4`
- PRs #7, #14, #16 and #18 integrated; question indexes regenerated (P-010, P-011, T-014, T-017) `9dc4c17`
- situations cache size in the operation guide `2af3002`
- PRs #1, #8 and #11 integrated; Supabase ref out of CLAUDE.md; public repo and chat bridge decisions (D-021, D-022, T-014, P-012) `280a6f3`
- operation guide (alerts, ops status, UptimeRobot, memory, deploy) and decisions 41.5-41.12 (phase 38) `20a9c6e`
- P-010 (Tigris) and P-011 (UptimeRobot), answered by Santi through the coordinator `98d2d55`
- PRs #2, #3, #4 and #6 integrated; the coordinator integrates and deploys; chat between sessions (D-021, T-014) `2ba94cd`
- close H-009 and H-012 (phase 37); D-021 records the coordinator and the five sessions `e02c074`
- P-009 answered by Santi, T-017 under way (P-009, T-017) `9869d97`
- close the lab findings fixed on lab/optimization (H-010, H-020, H-021) `9532297`
- phase 36 deployed at 55d658d (T-014) `0e46b77`
- deck optimization review — bot blind spot, engine overhead, common seeds, search proposals; work split between sessions (H-018, H-019, H-020, H-021, T-017, P-009, D-021, H-010, R-012) `a21f89a`
- findings of phase 36 point to the rebased commit ab68ba2 `55d658d`
- close the findings fixed in phase 36 (H-002, H-003, H-005, H-006, H-007, H-008, H-013, H-014, H-015, H-016, P-006) `ffbf409`

### Pruebas

- the optimize confirmation test reuses the app that beforeAll already started — #32 and #33 each called listen (H-011, T-014) `52c87e3`
- verifica reclamos con workers 0.2.6 y 0.2.7 (T-014) `e2a084e`

### Mantenimiento

- engine-cli 0.3.3 — f's clock changes what the bots play, so cached chunks of 0.3.2 must not be reused (T-017) `a574691`
- engine-cli 0.3.2 — #5 took 0.3.1 first (H-011) `c4fe38d`
- the chat migration after the worker engine features one (D-021) `c920ded`
- no GitHub cache of the pnpm store on the PC's runners — it hung their post steps (D-023) `c6ac546`
- the move to the public repository starts at 1.0.0 (versions, tag, release notes) and keeps the PR numbering (reserved issues); zero open PRs first (D-022) `9d5ffdc`
- start the PC's runners with Git's bash first in the PATH, a pnpm folder per job, a shell check (D-023) `8b52ed0`
- run on the PC's own runners while the repository is private and out of Actions minutes — runner chosen by repo variables, Postgres and a port per runner, the PC's Rust, Dependabot paused (D-023) `c1a4f47`
- rehearsal of the move to a new public repository — one-commit tree with the noreply author, checks, step-by-step plan (D-022) `30bd68e`
- prepare the repository to go public — AGPL-3.0 license, pseudonyms in the Limitless fixtures, read-only CI token (D-022) `4d16ea8`
- run the Windows engine job only when it changed, build the Docker image on main, cancel superseded runs (phase 38) `ff39a7c`

### Hallazgos cerrados

- H-011 por `c4fe38d` en main
- H-004 por `7c9a34e` en main
<!-- /posta:cambios -->

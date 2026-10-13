# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El bloque siguiente lo mantiene Posta; el resto es de la persona.

## [Sin publicar]

<!-- posta:cambios -->
_Borrador generado al 2026-10-12 desde la etiqueta `v1.0.0` (37 commits). Escribí el «porqué» fuera de este bloque._

### Agregado

- simulations_calibration — the calibrations against tournaments and each report, read only (R-012, P-009) `a91f3a7`
- «repetir los últimos» — a faster worker copies the slow one at the end of a job, and the first result counts (phase 42) (#72) `51278c2`
- the log says how far the engine got and, on Linux and Android, its memory (D-026) `1ed7c66`
- returns without an attempt have a cap, and a worker's pause shows in the app (D-026) `1c217a8`
- «Reintentar lo que falló» — only the failed chunks of a failed job, with the same seeds; review leftovers of #68 `72f4c5c`
- a job is played whole with one engine — deckgym and games revision (phase 42) (#67) `d074912`
- the worker's hint and the worker_idle alert also say when no engine plays «et» or the f bots (H-051, H-018) (#65) `eb69b68`
- setup without questions (--setup --keep), checked before stopping the old worker, and from inside a packaged app (D-026) `ec21aa5`
- cards to try, locks on any list, a new search from a lab list or the list in a search in play (T-017 E3/E4) (#47, #49) `25ec08a`

### Corregido

- leftovers of #73 — a turned-down result hands the chunk to its copy, the hand-over checks the copy, the holder's revision for a job not fixed yet `84f362b`
- a CLI context does none of the server's start-up work (review of #73) `9ca749a`
- retrying a failed chunk also clears its returns (#72) `4f25a68`
- one push per pause episode, Termux's battery only on Android, and a pause never past 6 h (D-026) (#72) `94d8422`
- review of #71 — no retry for a job of a games revision the workers left, archived jobs come back, a failed job with nothing failed is settled `96297cd`
- review of #72 — a returned chunk goes to another worker first, and a pause is not taken for a dead worker (D-026) `1943e06`
- a result.json lost after a good engine run is the worker's problem, not an attempt (D-026) `8b333b1`
- the Android installer turns echo off before asking for the token (D-026) (#70) `564423e`
- review of #70 — a fossil is discarded by touching it, on the bench and as the Active `d4f643b`
- show an action offered twice once, and coach it as one `3027f42`
- review of #67 — games played in the archetype table, «orientativo» by the effective n, one worker with every feature `f409207`
- board audit — every follow-up choice deckgym offers can be touched where it points (Santi's report) (#69) `8ceb427`
- a tool already played is attached by touching the Pokémon (the card left the hand) `735fe59`
- a mixed pairing shows the games played, the archetype's current name, and counts say their unit (review of #44) `1ad9763`
- #63 — the old worker comes back whatever fails while putting things back (D-026) `7792764`
- the slow-bots test worker lists etBot, and «et» cannot be the consistency bot (H-051) `e5235d9`
- review of #64 — lists added by hand checked by list, rules and locks, never learned, kept past patience; include with reasons and pre-evolutions (T-017 E3/E4) `cf7ca95`
- review of #63 — setup never leaves the PC without a worker, and relaunches itself outside a packaged app (D-026) (UTF-16) `955cd63`
- the bot that ends its turn («et») can be played — engine-cli 0.3.5 with the etBot feature (H-051) `a2ee93d`
- setup and --uninstall run the executable's own code when the downloaded release is older (D-026) `0a45eb5`

### Documentado

- PRs #59-#77 integrated — H-051 to H-054, P-007/P-010/P-013 closed, phase 39 in production, log of 12/10 (H-051, H-052, H-053, H-054, P-013, P-010, R-006, R-012, T-014, T-015, T-017) (#65, #398, #69, #70, R-003, P-009, D-026, #58, #62, #75) `c55a72a`
- tag v1.0.0 on #62's commit, phase 39 in production, what pins a job's engine; production CLIs in OPERACION (P-013, P-010, R-006) (#68, #75) `6cce6b5`
- decision 55.6 (the Active's sheet), upstream issue in 55.4 `7cb1285`
- decisions 55.4-55.5 (identical options, Miraculous Memory) `fae6e30`

### Pruebas

- the CLI context test covers every guard — no SchedulerRegistry, no watcher timers, no set seeding (review of #75) `71d2af9`

### Mantenimiento

- bump the development group with 2 updates (#61) `7f62616`
- bump the production group with 3 updates (#60) `a7f8afc`
- bump actions/setup-node from 4 to 7 (#59) `db16eeb`
<!-- /posta:cambios -->

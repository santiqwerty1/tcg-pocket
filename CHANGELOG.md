# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El bloque siguiente lo mantiene Posta; el resto es de la persona.

## [Sin publicar]

<!-- posta:cambios -->
_Borrador generado al 2026-10-13 desde la etiqueta `v1.0.0` (82 commits). Escribí el «porqué» fuera de este bloque._

### Agregado

- pnpm decisiones numbers the pending decisions into DECISIONES.md, with --check and node:test tests in the CI (D-021) `4608506`
- rooms in the session chat — «tcg» by default, «posta» new (D-021) `3ff3609`
- the browser's engine is kept after its first load, and a device that cannot run it is told to play on the PC (T-015) (R-003) `db14130`
- a browser game carries how its engine plays — another one ends it as engine_changed, and no worker strands it (T-015) `a167da9`
- play against the bot in the browser with the engine in WebAssembly — #57 by Nube-2, on main (T-015) `d550aca`
- a calibration plays up to 30 archetypes, the Laboratorio's bank stays at 20, and the screen picks the size (D-029) `d922b36`
- fill the weakest places — after the probe, every way to fill the two weakest places with the meta's five favourites, its best three verified together with a Bonferroni bar (T-017 C8) `fae260b`
- blind spots per card — what the bots play badly or the engine approximates, «sensible al bot» on a variant that brings one in (T-017 A3) `1eef498`
- the «carta más floja» probe round — what each card is worth, the weakest third out more often (T-017 C3) (H-020) `fdc94f3`
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

- self-review of room_since — one statement for Santi's path, a reorder keeps it, a hand edit does not break reads (D-021) `b77bfac`
- joining a room later reads it from then on (review of #88) (D-021) `f876927`
- the live_games runner migration after chat_rooms, which production already has (T-015) (#88) `65e7b7f`
- the self-review of #86 — undoing never stops a game, no undo that would lose a result, writes conditioned on what was read (T-015) `8cec6b2`
- review of decisiones — a row already in DECISIONES found cell by cell (also compact), the pendings that create a section first, `nueva: "true"` with quotes, an empty decisions table filled under its header, only the first row of a table taken as its header, the temporary file ignored, and REVISION.md says what the CI runs (D-021) `e7ba9ea`
- verification of decisiones — no temporary left, a row twice in one pending refused, the usual header without separator, «>-» refused, a similar section said, the PR's pending independent of the order (D-021) `7e8bde3`
- self-review of decisiones — a new section only with `nueva: true`, a row already in DECISIONES refused, two cells per row, prose and empty sections refused, BOM, code fences, a --root without DECISIONES, written through a temporary file, --check in the CI (D-021) `0519ecd`
- a browser game keeps its engine's build, a page that is behind is told to reload, and the job is a POST (review of #86, T-015) `c41a47f`
- 'wasm-unsafe-eval' only for the engine's worker, a 401 for /engine/, the engine's source in About, and CI without engine-cli for wasm-only changes (review of #86, T-015) `b8f26ae`
- a no-break space before «%» and after «IC», and one number formatter for the counts (phone review, DECISIONES 56.9–56.10) `3ff78d4`
- review of #88 — unread in the other rooms, errors only of the room asked, «Sumar» adds a room (D-021) `c8fd208`
- the wasm check runs the smoke with the app's Node 24, not Debian's 18 (T-015) `c0be378`
- review of #87 — the Fase 31 Trades test back, the old-data warning only for the current era, Matchups «contra todos» with n and «orientativo», rewards with the catalog's names and «·» between items, a test for the long word in the deck's columns `05f821a`
- the wasm check copies engine-cli's golden games, which the browser engine's native test reads (T-015) `d5c888f`
- phone review — nothing wider than a 375 px phone, every rate with its n and interval, the week's rate with ties as games not won, tournament windows with their dates, rewards in Spanish, «falta 1», and a word for screens waiting without signal `0d807cc`
- review of #85 — the reports hang from their dataset weakly, a report served goes back to the end of the line, and a page of a calibration still playing says so (R-008) `7b87729`
- review of #84 — only the fill lists that change one place go to the combos, candidates must fit on their own, the cards to try go first on purpose (T-017 C8) `bd6985c`
- after #82 — «in your deck» is a search only with «random» or «search» in the same sentence; Veluza's condition is not (T-017 A3) `5640831`
- review of #82 — a coin counts as variable damage only when it changes the damage, random targets and «equal to the damage», Pokémon Communication searches the deck, Lusamine is no random discard, «carta con punto ciego» instead of «sensible al bot», a table test of real cards (T-017 A3) `5c2dc51`
- second review of #78 — the weakest third's ×3 floor only while the probe is all that measured the card (outBoost) (T-017 C3) `9c7d877`
- review of #78 — fillers the event allows, a probe that cannot be built is refused, all of it to «−card», the weakest third by the interval and as a floor, labels of their own, the plan and Claude see the probe round (T-017 C3) `688be32`
- a copy goes on as the holder only with the job's games revision, and the holder's failure is retried once with the row as it is now (review of #76) `dc8ca59`
- after #64 — 30 s for «Sumar» and «Frenar» on a busy search, the event rule tested on its own, an evolution to try brings an unowned pre-evolution (T-017 E3/E4) `443c1a3`
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

### Cambiado

- one live game for engine-cli play and the browser — live.rs shared, GAMES_REV in seeds.rs (T-015) `e3e6a03`
- the calibration's report is kept while nothing it is made of changes, and the full tool report goes by pages (D-029) `bb7baf4`

### Documentado

- decision 46.23 — the bridge's refs carry the PC (review of #88) (D-021) `f0293c7`
- self-review checklist, decisions without conflicts, review by risk and rotating sessions (D-021) `2c9c273`
- the browser's engine on main (DECISIONES 53.9–53.13, T-015, R-003, P-008, API), and «dos lugares por worker» closed with worker-timing (45.58, H-019) `6679634`
- DECISIONES 40.30 says a Basic and its evolution that only work together are left out of the fill candidates (T-017 C8) `addb130`
- Santi's decision on P-009 — e2 stays the default bot, a larger bank next (D-029) (R-012, H-051, H-052, H-054) `0e794ec`
- calibration of the bots against tournaments, which bot by default (P-009, R-012) `8408103`
- the gamesRev design is DECISIONES 45.54 (45.53 went to #79's copy rule) (T-014) `a279881`
- production is at b0c3627 with #77 (T-014) `c7ae5c8`
- the personal mail as commit author since the move — noreply from now on, what is published stays (R-013, D-022) `cf41553`
- Posta's draft with the vault update of 12/10 (T-014) `2344477`
- PRs #59-#77 integrated — H-051 to H-054, P-007/P-010/P-013 closed, phase 39 in production, log of 12/10 (H-051, H-052, H-053, H-054, P-013, P-010, R-006, R-012, T-014, T-015, T-017) (#65, #398, #69, #70, R-003, P-009, D-026, #58, #62, #75) `6a234dc`
- tag v1.0.0 on #62's commit, phase 39 in production, what pins a job's engine; production CLIs in OPERACION (P-013, P-010, R-006) (#68, #75) `b4e9872`
- decision 55.6 (the Active's sheet), upstream issue in 55.4 `7cb1285`
- decisions 55.4-55.5 (identical options, Miraculous Memory) `fae6e30`

### Pruebas

- the browser's own golden games, the move played is the one shown, and the build in the manifest (review of #86, T-015) `1cbc737`
- the CLI context test covers every guard — no SchedulerRegistry, no watcher timers, no set seeding (review of #75) `71d2af9`

### Mantenimiento

- bump the development group with 2 updates (#61) `7f62616`
- bump the production group with 3 updates (#60) `a7f8afc`
- bump actions/setup-node from 4 to 7 (#59) `db16eeb`

### Decidido

- 2026-10-13 — D-028 aprobada por Santiago: Aprobada por Santiago el 13/10/2026 (respuesta al Coordinador), después de probar la sincronización a mano desde Colección. La automática ya estaba prendida desde el 12/10 21:28 (trackerAutoSync).
- 2026-10-13 — D-027 aprobada por Santiago: Aprobada por Santiago el 13/10/2026 (respuesta al Coordinador): el criterio del análisis exploratorio queda como está.
<!-- /posta:cambios -->

# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El bloque siguiente lo mantiene Posta; el resto es de la persona.

## [Sin publicar]

<!-- posta:cambios -->
_Borrador generado al 2026-10-08 (69 commits). Escribí el «porqué» fuera de este bloque._

### Agregado

- play against the exact list of a recent tournament (phase 23) `92e8b92`
- the board — replay viewer and games against the bot (phase 22) `bc4947f`
- board data, undo and rematch for games against the bot (phase 22, part 1) `739268e`
- portable worker package for another PC `97adf4b`
- phase 21 — catalog remap (I12) and deploy only what passed CI (R-001, R-007, T-012) `87b36dc`
- phase 20 — coach mode against the bot (T-012) `fc6f7bc`
- phase 19 — build a deck from a core of cards (T-012) `b3e9216`
- phase 18 — notifications to the phone (T-012) `625a9d4`
- phase 17 — pack luck between CSV imports (T-012) `495068b`
- phase 16 — events with deck rules (T-012) `8e57fc4`
- phase 15 — which deck to bring today (T-012) `79ade03`
- phase 14 — how many days until a deck is complete (T-012) `03b1a41`
- phase 13 — bad run or bad matchup? (T-012) `88660db`
- phase 12 — notes by rival (T-012) `3c426b8`
- update the starting deck with the version the search found (T-008) `c2c0711`
- phase 11 — weekly meta, what rises and what falls (T-012) `13185d8`
- phase 10 — opening hand and natural draw odds (T-012) `0c5741a`
- phase 9 — tournament matchups from Limitless pairings (T-012) (#45) `9fd38b2`
- Santi's D-019 answers, simulation archive, installable PWA (D-019, T-011) `ee6f4bd`
- phase 8 — play against a bot, deck consistency, substitutes, alerts, missions (D-019, T-011) `d8728e7`
- Santi's answers of 8/10 — deep lab defaults, confirmed rarities, saved pack points (D-018, P-003, P-004, S-002) (P-002) `64e6e38`
- deck laboratory — meta bank, tests against it, automatic search of variants (T-008) (D-018) `dc2dcad`
- «armado» checkbox in the deck list; ← → between decks `2a66a25`
- deckgym 33ff2a5 — bounded bot search, turn action limit, Quick Growth fix (T-010) `43d103f`
- owner decisions of 8/10 — limited ×3, retired points, deckgym viewer, upstream check, Posta on (D-007, D-008, D-009, D-014, T-010) (D-011, D-017, T-005, T-007) `595f973`
- Claude can write — decks, matches and simulations (phase 7, M8 part 2) (D-017, T-009) `8a81661`
- «versión de torneo» of each deck and Sobres aiming at it (D-016, T-008) `bc19f7a`
- one worker per folder; install-task starts it and says why schtasks failed (T-007) `a1d5140`
- heat-map table, replay filter, phone layout and multi-worker ETA `bd7b381`
- deckgym simulation with a Windows worker (phase 6, M7) `013890f`
- tournament results from Limitless by era (phase 5, M5) (D-010, D-012, R-008, R-009, T-006) `ca79964`
- limited-time packs, trade advice and version-aware exclusives (phase 4) `07ebe68`
- pack recommendation with the tracker model and a corrected one (phase 4, M4) `2a266b6`
- read-only MCP server for Claude, closest deck, random deck and best prints (phase 3) `5d081ed`
- match logging with Wilson statistics (phase 2, M6) `b7c4232`
- show card names in the deck import preview `4f751b7`
- collection, decks, backup and settings endpoints per docs/API.md `b0fa80d`
- PWA shell and phase 1 screens against docs/API.md `f269441`
- infrastructure — Prisma 7 schema, auth (password+TOTP, sessions), protected static serving, API tokens, catalog sync, deploy files `556cacc`
- decks module (Spanish/deckgym/Limitless/JSON formats, validation, completeness, limits, revisions) `2fd9f0c`
- collection module (tracker CSV, stock units, playable copies, adjustments, import diff) `e1216fb`
- catalog module built from the tracker and deckgym data `ed1375d`

### Corregido

- pager label does not repeat the deck number (#13) `9e426f9`
- up to 150 decks per side, said plainly; validation errors name the field `2dbc3aa`
- a matrix with an empty «Contra» side plays side A against itself; engine status survives an engine update `212cd11`
- engine off Windows efficiency mode; quick jobs first; phase 6 acceptance (H-001, T-004) `e81e220`
- set NODE_EXTRA_CA_CERTS in fly.toml and record decision 1.32 `3574f78`
- trust the Supabase pooler CA so sslmode=verify-full works in production `a9dac63`
- address the adversarial review `72b2082`

### Documentado

- Santi's approval of phases 2-8 and the lab (T-008, T-009, T-011, T-001, T-002, R-004) `adf0fc0`
- D-019 answers deployed, worker 0.2.1 (D-019, T-011) `661ebb2`
- phase 8 deployed — catalog with missions, worker 0.2.0 (T-011, D-019) `c1acadc`
- lab deployed to production (T-008, D-018) `82da0d6`
- phase 5 acceptance verified on production data `5848fdb`
- phase 4 approved; pending decisions flagged for later review (P-005, T-003, D-007, D-008, D-009, P-002, P-004, S-002) `59eaf3d`
- Obsidian vault with the Posta kit (tablero dialect) (D-009, R-007) `cacfa8a`
- production deployed on Fly + Supabase; ops notes `853bb69`
- phase 1 implementation verified; deploy pending `b0c5b14`
- record API implementation decisions and phase 1 state `629407b`
- REST contract for phase 1 (auth, catalog, collection, decks, backup, tokens) `a703dc7`
- record phase 1 implementation decisions `189252b`
- phase 0 plan, decisions, licenses and research `e8e477e`

### Pruebas

- type deckTarget in the packs e2e response `085a8ae`

### Mantenimiento

- config written by posta (ci off, hooks via plugin) `aa90463`
- worker package in the Docker deps stage; keep engine/target out of the context `a9a1b4c`
- local Postgres 17 via docker compose and .env.example `9681c20`
- scaffold apps/api (NestJS 12, ESM, Prisma 7) and apps/web (Vite 8, React 19, PWA deps) `338e565`
- scaffold pnpm monorepo, domain package skeleton, fixtures and CI `e133151`
- enforce LF line endings and keep CSV fixtures byte-exact `461affb`
<!-- /posta:cambios -->

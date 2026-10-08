# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El bloque siguiente lo mantiene Posta; el resto es de la persona.

## [Sin publicar]

<!-- posta:cambios -->
_Borrador generado al 2026-10-08 (32 commits). Escribí el «porqué» fuera de este bloque._

### Agregado

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

- engine off Windows efficiency mode; quick jobs first; phase 6 acceptance (H-001, T-004) `e81e220`
- set NODE_EXTRA_CA_CERTS in fly.toml and record decision 1.32 `3574f78`
- trust the Supabase pooler CA so sslmode=verify-full works in production `a9dac63`
- address the adversarial review `72b2082`

### Documentado

- phase 5 acceptance verified on production data `5848fdb`
- phase 4 approved; pending decisions flagged for later review (P-005, T-003, D-007, D-008, D-009, P-002, P-004, S-002) `59eaf3d`
- Obsidian vault with the Posta kit (tablero dialect) (D-009, R-007) `cacfa8a`
- production deployed on Fly + Supabase; ops notes `853bb69`
- phase 1 implementation verified; deploy pending `b0c5b14`
- record API implementation decisions and phase 1 state `629407b`
- REST contract for phase 1 (auth, catalog, collection, decks, backup, tokens) `a703dc7`
- record phase 1 implementation decisions `189252b`
- phase 0 plan, decisions, licenses and research `e8e477e`

### Mantenimiento

- worker package in the Docker deps stage; keep engine/target out of the context `a9a1b4c`
- local Postgres 17 via docker compose and .env.example `9681c20`
- scaffold apps/api (NestJS 12, ESM, Prisma 7) and apps/web (Vite 8, React 19, PWA deps) `338e565`
- scaffold pnpm monorepo, domain package skeleton, fixtures and CI `e133151`
- enforce LF line endings and keep CSV fixtures byte-exact `461affb`
<!-- /posta:cambios -->

# tcg-pocket

App personal de Pokémon TCG Pocket: colección, mazos, sobres, torneos, simulación y herramientas MCP para Claude. Un solo usuario.

- Plan y decisiones: `docs/PLAN.md`, `docs/DECISIONES.md`, `docs/LICENCIAS.md`.
- Instrucciones de trabajo: `CLAUDE.md`.
- Monorepo pnpm: `packages/domain` (lógica pura con tests sobre datos reales), `apps/api` (NestJS), `apps/web` (PWA React), `apps/worker` (PC Windows), `engine/engine-cli` (Rust, envoltorio de deckgym).

```bash
pnpm install
pnpm test
```

# Fixtures

Real data used by the domain tests. Regenerate with `pnpm fixtures:extract` (needs `refs/` cloned at the pinned commits).

| File | Source | Commit | License |
|---|---|---|---|
| `tracker/cards.json`, `tracker/*_translations.json`, `tracker/CardsDB.ts`, `tracker/types.index.ts`, `tracker/es-ES.*.json`, `tracker/en-US.*.json` | marcelpanse/tcg-pocket-collection-tracker | `3ab58f1cec6a03e3e85455cf7aade3bb8561f92e` (2026-10-01) | GPL-3.0 (see docs/LICENCIAS.md) |
| `deckgym/engine-cards.json` | bcollazo/deckgym-core `database.json`, reduced to id/name/stage/evolves_from/hp/energy/rarity/trainer type | `fb792ebfbaca995af9750c28101ce92a51282825` (2026-10-04) | AGPL-3.0 (data; see docs/LICENCIAS.md) |

`invented/` holds **made-up** fixtures, marked as such, for data that does not exist yet (C1's dual types): see its README.

Other fixtures used by tests live outside this folder: `docs/context/tcgcollectiontracterexport-2026-10-06.csv` (collection export, sha256 `f774c6e4…17e8`), `docs/context/mazos_40_listas.md` (the 40 decks), `docs/fase0/limitless/*.json` (tournament standings), `docs/fase0/fixtures-sobres-2026-10-06.json` (pack probabilities).

# Fixtures

Real data used by the domain tests. Regenerate with `pnpm fixtures:extract` (needs `refs/` cloned at the pinned commits).

| File | Source | Commit | License |
|---|---|---|---|
| `tracker/cards.json`, `tracker/*_translations.json`, `tracker/CardsDB.ts`, `tracker/types.index.ts`, `tracker/es-ES.*.json`, `tracker/en-US.*.json` | marcelpanse/tcg-pocket-collection-tracker | `3ab58f1cec6a03e3e85455cf7aade3bb8561f92e` (2026-10-01) | GPL-3.0 (see docs/LICENCIAS.md) |
| `tracker/CardsDB.aac8d456.ts` (only the `expansions` and `craftingCost` literals; copied by hand, not by `fixtures:extract`) | marcelpanse/tcg-pocket-collection-tracker | `aac8d456f6f02565dcb81c59101420d008ad6200` (2026-10-15) | GPL-3.0 (see docs/LICENCIAS.md) |
| `deckgym/engine-cards.json` | bcollazo/deckgym-core `database.json`, reduced to id/name/stage/evolves_from/hp/energy/rarity/trainer type | `fb792ebfbaca995af9750c28101ce92a51282825` (2026-10-04) | AGPL-3.0 (data; see docs/LICENCIAS.md) |

`invented/` holds **made-up** fixtures, marked as such, for data that does not exist yet (C1's dual types): see its README.

`pokemon-zone/` holds what the pokemon-zone bookmarklet sends, on the site's real shape. Policy (review of #172): **nunca números reales de la cuenta salvo totales de sobres y rarezas perturbados**. pokemon-zone's profiles are public, with leaderboards: a level, a Shinedust balance or a battle record can lead back to the profile, its friend id and its in-game name. So the account hash is the SHA-256 of a made-up friend id, and level, currencies, hourglasses, battles, ranked points, pack points and tickets are **made up**; packs and rarities only keep rough proportions, perturbed.

- `payload.json` (2/11/2026, before the policy): the identifying fields are made up; its pack and rarity totals are a real account's, not perturbed (see its `_nota`). The domain tests, the API e2e and the screens use it.
- `made-up-2026-11-02.json` (version 2 of the bookmarklet) and `made-up-2026-11-03.json` (version 1): two consecutive reads, made up under the policy, for the luck between imports (pz/luck).

Other fixtures used by tests live outside this folder: `docs/context/tcgcollectiontracterexport-2026-10-06.csv` (collection export, sha256 `f774c6e4…17e8`), `docs/context/mazos_40_listas.md` (the 40 decks), `docs/fase0/limitless/*.json` (tournament standings), `docs/fase0/fixtures-sobres-2026-10-06.json` (pack probabilities).

`docs/context/tcgcollectiontracterexport-2026-11-11.csv` (sha256 `595b1da6…a14e`, 238,381 bytes, 4,547 rows) is the collection export of 11/11/2026, with C1 and P-C. It matches the catalog at tracker `9fafc07` (no unknown ids, no `InternalId` mismatches; 9,348 copies as a plain sum, 7,334 once twin editions count once). No test uses it yet: the catalog fixture above is `3ab58f1`, without C1, and the tests keep the 6/10 export.

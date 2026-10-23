-- 22/10/2026: the printed types of a card as a list, for the dual-type Pokémon of C1 «Dual Fusion» (29/10/2026).
-- `energy` stays (the first type, or 'trainer'). The existing Pokémon get their one type, so the loaded catalog reads
-- the same before the next sync rewrites the table; trainers keep the empty list. About 4.300 rows.
ALTER TABLE "cards" ADD COLUMN "types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "cards" SET "types" = ARRAY["energy"] WHERE "card_type" = 'pokemon' AND "energy" <> 'trainer';

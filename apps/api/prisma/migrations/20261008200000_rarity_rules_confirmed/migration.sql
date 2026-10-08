-- Confirmed by Santi in the game on 8/10/2026 (P-003, P-004): ✵ and ✵✵ cost 1000 and 1350 pack points and, like ☆☆,
-- can be traded (☆☆☆, ♛ and promos cannot).
INSERT INTO "rarity_rules" ("rarity", "points", "points_verified", "tradeable")
VALUES ('✵', 1000, true, true), ('✵✵', 1350, true, true)
ON CONFLICT ("rarity") DO UPDATE SET "points" = EXCLUDED."points", "points_verified" = true, "tradeable" = true;

INSERT INTO "rarity_rules" ("rarity", "points", "points_verified", "tradeable")
VALUES ('☆☆', 1250, false, true)
ON CONFLICT ("rarity") DO UPDATE SET "tradeable" = true;

-- Fase 4 (sobres): defaults of owner settings that existing databases did not get.
-- The Deluxe ex pack (A4b) left the shop: off until the owner switches it on (PLAN B9, DECISIONES 4.x).
UPDATE "packs" SET "available" = false WHERE "id" = 'A4b/deluxepack';

-- Pack-point costs the tracker does not publish (community values, unverified until the owner confirms them).
INSERT INTO "rarity_rules" ("rarity", "points", "points_verified", "tradeable")
VALUES ('✵', 1000, false, false), ('✵✵', 1350, false, false)
ON CONFLICT ("rarity") DO NOTHING;

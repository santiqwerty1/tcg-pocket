-- AlterTable
ALTER TABLE "packs" ADD COLUMN     "limited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "limited_until" DATE;

-- The Deluxe Mega (B4b) is sold for a limited time: 30/9 to 29/10/2026 (Serebii, Pocket Gamer), last safe day 28/10
-- in Buenos Aires. Existing databases already have the pack; new ones get it from the catalog sync (DECISIONES 4.9).
UPDATE "packs" SET "limited" = true, "limited_until" = DATE '2026-10-28' WHERE "id" = 'B4b/deluxepackmega';

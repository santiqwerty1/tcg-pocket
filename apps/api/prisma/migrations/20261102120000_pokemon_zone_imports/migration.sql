-- pokemon-zone (2/11/2026): the game's counters read from pokemon-zone.com by the owner's browser. One new table;
-- nothing else changes.
CREATE TABLE "pokemon_zone_imports" (
    "id" SERIAL NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,
    "account" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "applied" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "pokemon_zone_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pokemon_zone_imports_account_synced_at_sha256_key" ON "pokemon_zone_imports"("account", "synced_at", "sha256");

CREATE INDEX "pokemon_zone_imports_synced_at_idx" ON "pokemon_zone_imports"("synced_at");

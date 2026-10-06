-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "catalog_sync_status" AS ENUM ('running', 'applied', 'failed', 'needs_review');

-- CreateEnum
CREATE TYPE "catalog_sync_source" AS ENUM ('github', 'fixtures');

-- CreateEnum
CREATE TYPE "collection_import_status" AS ENUM ('pending', 'applied', 'discarded');

-- CreateEnum
CREATE TYPE "collection_stock_source" AS ENUM ('import', 'manual');

-- CreateEnum
CREATE TYPE "adjustment_resolution" AS ENUM ('user', 'csv_matches', 'manual_edit', 'converted', 'catalog_change');

-- CreateEnum
CREATE TYPE "deck_source" AS ENUM ('ui', 'import', 'mcp', 'duplicate', 'restore');

-- CreateEnum
CREATE TYPE "api_token_kind" AS ENUM ('worker', 'mcp');

-- CreateTable
CREATE TABLE "catalog_syncs" (
    "id" SERIAL NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "engine_rev" TEXT NOT NULL,
    "source" "catalog_sync_source" NOT NULL,
    "status" "catalog_sync_status" NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "applied_at" TIMESTAMPTZ(3),
    "file_hashes" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "report" JSONB,
    "crafting_cost" JSONB,
    "error" TEXT,

    CONSTRAINT "catalog_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_sync_changes" (
    "id" SERIAL NOT NULL,
    "sync_id" INTEGER NOT NULL,
    "card_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old" JSONB,
    "new" JSONB,

    CONSTRAINT "catalog_sync_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expansions" (
    "id" TEXT NOT NULL,
    "tracker_internal_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_promo" BOOLEAN NOT NULL,
    "tradeable" BOOLEAN NOT NULL,
    "openable_tracker" BOOLEAN NOT NULL,
    "cards_per_pack" INTEGER,
    "contains_shinies" BOOLEAN NOT NULL DEFAULT false,
    "contains_babies" BOOLEAN NOT NULL DEFAULT false,
    "contains_linked_cards" BOOLEAN NOT NULL DEFAULT false,
    "release_date" DATE,
    "opens_era" BOOLEAN,

    CONSTRAINT "expansions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" TEXT NOT NULL,
    "expansion_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "points_balance" INTEGER,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_cards" (
    "pack_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "pack_cards_pkey" PRIMARY KEY ("pack_id","card_id")
);

-- CreateTable
CREATE TABLE "functional_groups" (
    "id" TEXT NOT NULL,
    "display_card_id" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "card_type" TEXT NOT NULL,
    "rules_hash" TEXT NOT NULL,
    "edition_count" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "functional_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "expansion_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "internal_id" INTEGER NOT NULL,
    "stock_card_id" TEXT NOT NULL,
    "functional_group_id" TEXT NOT NULL,
    "is_display_edition" BOOLEAN NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_es_source" TEXT NOT NULL,
    "hp" INTEGER,
    "energy" TEXT NOT NULL,
    "card_type" TEXT NOT NULL,
    "evolution_type" TEXT NOT NULL,
    "evolves_from" TEXT,
    "is_fossil" BOOLEAN NOT NULL,
    "ex" BOOLEAN NOT NULL,
    "prize_points" INTEGER NOT NULL,
    "baby" BOOLEAN NOT NULL,
    "rarity" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "attacks" JSONB NOT NULL,
    "ability" JSONB,
    "weakness" TEXT,
    "retreat" INTEGER,
    "image_url" TEXT NOT NULL,
    "engine_id" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    "alternate_versions_raw" INTEGER[],
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evolution_aliases" (
    "card_id" TEXT NOT NULL,
    "counts_as" TEXT NOT NULL,

    CONSTRAINT "evolution_aliases_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "rarity_rules" (
    "rarity" TEXT NOT NULL,
    "points" INTEGER,
    "points_verified" BOOLEAN NOT NULL DEFAULT false,
    "tradeable" BOOLEAN NOT NULL,

    CONSTRAINT "rarity_rules_pkey" PRIMARY KEY ("rarity")
);

-- CreateTable
CREATE TABLE "collection_imports" (
    "id" SERIAL NOT NULL,
    "file_name" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),
    "status" "collection_import_status" NOT NULL DEFAULT 'pending',
    "row_count" INTEGER NOT NULL,
    "naive_total" INTEGER NOT NULL,
    "dedup_total" INTEGER NOT NULL,
    "unknown_ids" TEXT[],
    "diff_summary" JSONB,
    "raw_file_gz" BYTEA NOT NULL,

    CONSTRAINT "collection_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_import_rows" (
    "import_id" INTEGER NOT NULL,
    "card_id" TEXT NOT NULL,
    "internal_id" INTEGER NOT NULL,
    "number_owned" INTEGER NOT NULL,
    "collected" BOOLEAN NOT NULL,

    CONSTRAINT "collection_import_rows_pkey" PRIMARY KEY ("import_id","card_id")
);

-- CreateTable
CREATE TABLE "collection_stock" (
    "card_id" TEXT NOT NULL,
    "amount_owned" INTEGER NOT NULL,
    "collected" BOOLEAN NOT NULL DEFAULT false,
    "source" "collection_stock_source" NOT NULL,
    "import_id" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_stock_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "collection_adjustments" (
    "id" SERIAL NOT NULL,
    "functional_group_id" TEXT NOT NULL,
    "playable_copies" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" "adjustment_resolution",

    CONSTRAINT "collection_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "energies" TEXT[],
    "tags" TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "built_in_game" BOOLEAN NOT NULL DEFAULT false,
    "built_in_game_since" TIMESTAMPTZ(3),
    "variant_of_id" INTEGER,
    "pack_priority" INTEGER NOT NULL DEFAULT 0,
    "key_cards" JSONB NOT NULL DEFAULT '[]',
    "archived_at" TIMESTAMPTZ(3),
    "current_revision_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deck_revisions" (
    "id" SERIAL NOT NULL,
    "deck_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "cards" JSONB NOT NULL,
    "energies" TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "source" "deck_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deck_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deck_changes" (
    "id" SERIAL NOT NULL,
    "deck_id" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "old" JSONB,
    "new" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "deck_source" NOT NULL,

    CONSTRAINT "deck_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deck_cards" (
    "deck_id" INTEGER NOT NULL,
    "card_id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "deck_cards_pkey" PRIMARY KEY ("deck_id","card_id")
);

-- CreateTable
CREATE TABLE "owner" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id_hash")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "api_token_kind" NOT NULL,
    "scopes" TEXT[],
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "backup_blobs" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "size_bytes" INTEGER NOT NULL,
    "data_gz" BYTEA NOT NULL,

    CONSTRAINT "backup_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_syncs_status_id_idx" ON "catalog_syncs"("status", "id");

-- CreateIndex
CREATE INDEX "catalog_sync_changes_sync_id_idx" ON "catalog_sync_changes"("sync_id");

-- CreateIndex
CREATE INDEX "packs_expansion_id_idx" ON "packs"("expansion_id");

-- CreateIndex
CREATE INDEX "pack_cards_card_id_idx" ON "pack_cards"("card_id");

-- CreateIndex
CREATE INDEX "functional_groups_name_en_idx" ON "functional_groups"("name_en");

-- CreateIndex
CREATE INDEX "cards_internal_id_idx" ON "cards"("internal_id");

-- CreateIndex
CREATE INDEX "cards_stock_card_id_idx" ON "cards"("stock_card_id");

-- CreateIndex
CREATE INDEX "cards_functional_group_id_idx" ON "cards"("functional_group_id");

-- CreateIndex
CREATE INDEX "cards_name_en_idx" ON "cards"("name_en");

-- CreateIndex
CREATE INDEX "cards_engine_id_idx" ON "cards"("engine_id");

-- CreateIndex
CREATE INDEX "cards_search_text_idx" ON "cards" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "collection_adjustments_functional_group_id_idx" ON "collection_adjustments"("functional_group_id");

-- CreateIndex
CREATE INDEX "decks_archived_at_idx" ON "decks"("archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "deck_revisions_deck_id_number_key" ON "deck_revisions"("deck_id", "number");

-- CreateIndex
CREATE INDEX "deck_changes_deck_id_at_idx" ON "deck_changes"("deck_id", "at");

-- CreateIndex
CREATE INDEX "deck_cards_card_id_idx" ON "deck_cards"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_email_key" ON "owner"("email");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "catalog_sync_changes" ADD CONSTRAINT "catalog_sync_changes_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "catalog_syncs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_expansion_id_fkey" FOREIGN KEY ("expansion_id") REFERENCES "expansions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_cards" ADD CONSTRAINT "pack_cards_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_cards" ADD CONSTRAINT "pack_cards_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_expansion_id_fkey" FOREIGN KEY ("expansion_id") REFERENCES "expansions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_functional_group_id_fkey" FOREIGN KEY ("functional_group_id") REFERENCES "functional_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_import_rows" ADD CONSTRAINT "collection_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "collection_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_stock" ADD CONSTRAINT "collection_stock_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_adjustments" ADD CONSTRAINT "collection_adjustments_functional_group_id_fkey" FOREIGN KEY ("functional_group_id") REFERENCES "functional_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decks" ADD CONSTRAINT "decks_variant_of_id_fkey" FOREIGN KEY ("variant_of_id") REFERENCES "decks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_revisions" ADD CONSTRAINT "deck_revisions_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_changes" ADD CONSTRAINT "deck_changes_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------
-- Hand-written steps (docs/PLAN.md §4.2). Prisma does not model partial indexes or CHECK constraints; it also
-- ignores them when diffing, so they survive future `migrate dev` runs.
-- ---------------------------------------------------------------------------------------------------------------

-- Invariant I4: at most one active adjustment per functional group.
CREATE UNIQUE INDEX "collection_adjustments_one_active_per_group"
  ON "collection_adjustments" ("functional_group_id") WHERE "active";

ALTER TABLE "collection_stock" ADD CONSTRAINT "collection_stock_amount_owned_non_negative" CHECK ("amount_owned" >= 0);
ALTER TABLE "collection_adjustments" ADD CONSTRAINT "collection_adjustments_playable_copies_non_negative" CHECK ("playable_copies" >= 0);
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_count_positive" CHECK ("count" > 0);
ALTER TABLE "owner" ADD CONSTRAINT "owner_single_row" CHECK ("id" = 1);

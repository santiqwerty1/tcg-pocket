-- 22/10/2026 (T-020): the collection from the game through ptcgpocket.gg (DotGG). A third import source and stock
-- source, and a table for server-side secrets (the export link, sealed), which neither the settings API nor the backup
-- read. No existing row changes; the CHECK is checked against `collection_imports`, a table of a few dozen rows.
ALTER TYPE "collection_stock_source" ADD VALUE 'dotgg';
ALTER TABLE "collection_imports" DROP CONSTRAINT "collection_imports_source_check";
ALTER TABLE "collection_imports" ADD CONSTRAINT "collection_imports_source_check" CHECK (source IN ('csv', 'tracker', 'dotgg'));

CREATE TABLE "app_secrets" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("key")
);

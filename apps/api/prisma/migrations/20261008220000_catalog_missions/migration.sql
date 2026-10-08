-- Fase 8: the themed-collection missions travel with the catalog sync (like the crafting cost).
ALTER TABLE "catalog_syncs" ADD COLUMN "missions" JSONB;

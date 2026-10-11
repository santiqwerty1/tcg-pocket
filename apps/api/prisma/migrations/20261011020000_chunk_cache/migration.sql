-- Phase 42: the exact cache of chunks. Who played a result (engine-cli version) and where a copied one came from.
ALTER TABLE "simulation_chunks" ADD COLUMN "cli_version" TEXT;
ALTER TABLE "simulation_chunks" ADD COLUMN "cached_from_id" INTEGER;
CREATE INDEX "simulation_chunks_seed_idx" ON "simulation_chunks"("seed");

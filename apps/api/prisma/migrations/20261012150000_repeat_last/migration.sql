-- Phase 42, «repetir los últimos»: when the worker that holds a chunk took it (its pace), and a faster worker playing
-- the same chunk at the end of its job, whose result counts if it comes first.
ALTER TABLE "simulation_chunks" ADD COLUMN "leased_at" TIMESTAMPTZ(3);
ALTER TABLE "simulation_chunks" ADD COLUMN "shadow_worker_id" TEXT;
ALTER TABLE "simulation_chunks" ADD COLUMN "shadow_lease_until" TIMESTAMPTZ(3);
ALTER TABLE "simulation_chunks" ADD COLUMN "shadow_leased_at" TIMESTAMPTZ(3);
-- The chunks being played at the deploy: their start is not known, so from now (their pace is then underrated, and
-- a copy is less likely, never more).
UPDATE "simulation_chunks" SET "leased_at" = now() WHERE "status" = 'leased';

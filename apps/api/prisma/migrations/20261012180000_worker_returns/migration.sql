-- A worker that lost a chunk's result.json returns it without spending an attempt (worker 0.3.4, DECISIONES 51.19).
-- The returns are counted per chunk, with who returned it, so one that breaks every worker still fails (51.22).
ALTER TABLE "simulation_chunks" ADD COLUMN "returns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "simulation_chunks" ADD COLUMN "returned_by" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The pause a worker takes after losing results in a row, for Simulación and workers_status (51.23).
ALTER TABLE "worker_nodes" ADD COLUMN "paused_until" TIMESTAMPTZ(3);
ALTER TABLE "worker_nodes" ADD COLUMN "pause_reason" TEXT;

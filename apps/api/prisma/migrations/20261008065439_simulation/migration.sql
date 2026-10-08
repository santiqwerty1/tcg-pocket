-- CreateEnum
CREATE TYPE "SimulationKind" AS ENUM ('matrix', 'compare', 'optimize');

-- CreateEnum
CREATE TYPE "SimulationJobStatus" AS ENUM ('queued', 'running', 'done', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "SimulationChunkStatus" AS ENUM ('queued', 'leased', 'done', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "engine_cards" (
    "engine_rev" TEXT NOT NULL,
    "engine_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL,

    CONSTRAINT "engine_cards_pkey" PRIMARY KEY ("engine_rev","engine_id")
);

-- CreateTable
CREATE TABLE "worker_nodes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine_rev" TEXT,
    "cli_version" TEXT,
    "cores" INTEGER NOT NULL DEFAULT 1,
    "version" TEXT,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deck_snapshots" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "deck_id" INTEGER,
    "deckgym_text" TEXT NOT NULL,
    "energies" TEXT[],
    "energy_source" TEXT NOT NULL,
    "cards" JSONB NOT NULL,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "simulable" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deck_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_jobs" (
    "id" SERIAL NOT NULL,
    "kind" "SimulationKind" NOT NULL,
    "status" "SimulationJobStatus" NOT NULL DEFAULT 'queued',
    "label" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "engine_rev" TEXT NOT NULL,
    "players" TEXT[],
    "games_per_pair" INTEGER NOT NULL,
    "base_seed" BIGINT NOT NULL,
    "cores" INTEGER,
    "replay_sample" INTEGER NOT NULL DEFAULT 2,
    "total_games" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "simulation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_chunks" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "idx" INTEGER NOT NULL,
    "snapshot_a_id" INTEGER,
    "snapshot_b_id" INTEGER,
    "games" INTEGER NOT NULL,
    "first_game" INTEGER NOT NULL DEFAULT 0,
    "seed" BIGINT NOT NULL,
    "status" "SimulationChunkStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(3),
    "worker_id" TEXT,
    "games_done" INTEGER NOT NULL DEFAULT 0,
    "wins_a" INTEGER,
    "wins_b" INTEGER,
    "ties" INTEGER,
    "turns" BIGINT,
    "duration_ms" INTEGER,
    "engine_rev" TEXT,
    "extra" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "simulation_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_replays" (
    "id" SERIAL NOT NULL,
    "chunk_id" INTEGER NOT NULL,
    "game_id" TEXT NOT NULL,
    "game_index" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "winner" TEXT NOT NULL,
    "data_gz" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_replays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deck_snapshots_key_idx" ON "deck_snapshots"("key");

-- CreateIndex
CREATE INDEX "deck_snapshots_deck_id_idx" ON "deck_snapshots"("deck_id");

-- CreateIndex
CREATE INDEX "simulation_jobs_status_created_at_idx" ON "simulation_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "simulation_chunks_status_lease_until_idx" ON "simulation_chunks"("status", "lease_until");

-- CreateIndex
CREATE INDEX "simulation_chunks_snapshot_a_id_idx" ON "simulation_chunks"("snapshot_a_id");

-- CreateIndex
CREATE INDEX "simulation_chunks_snapshot_b_id_idx" ON "simulation_chunks"("snapshot_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_chunks_job_id_idx_key" ON "simulation_chunks"("job_id", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_replays_chunk_id_game_id_key" ON "simulation_replays"("chunk_id", "game_id");

-- AddForeignKey
ALTER TABLE "simulation_chunks" ADD CONSTRAINT "simulation_chunks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "simulation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_replays" ADD CONSTRAINT "simulation_replays_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "simulation_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fase 8: games of the owner against a bot, relayed by the worker one decision at a time.
-- CreateEnum
CREATE TYPE "LiveGameStatus" AS ENUM ('queued', 'running', 'waiting', 'done', 'abandoned', 'failed');

-- CreateTable
CREATE TABLE "live_games" (
    "id" SERIAL NOT NULL,
    "status" "LiveGameStatus" NOT NULL DEFAULT 'queued',
    "human_snapshot_id" INTEGER NOT NULL,
    "bot_snapshot_id" INTEGER NOT NULL,
    "bot" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "engine_rev" TEXT NOT NULL,
    "worker_id" TEXT,
    "lease_until" TIMESTAMPTZ(3),
    "choices" INTEGER[],
    "decision" JSONB,
    "log" JSONB NOT NULL DEFAULT '[]',
    "winner" TEXT,
    "turns" INTEGER,
    "final_state" JSONB,
    "replay_gz" BYTEA,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "live_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_games_status_idx" ON "live_games"("status");

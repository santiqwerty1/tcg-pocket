-- Fase 22: how many times the owner went back to an earlier decision.
ALTER TABLE "live_games" ADD COLUMN "undos" INTEGER NOT NULL DEFAULT 0;

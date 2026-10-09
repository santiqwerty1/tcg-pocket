-- Fase 20: modo entrenador. The engine scores every option of each decision; one review per owner choice.
ALTER TABLE "live_games" ADD COLUMN "coach" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "live_games" ADD COLUMN "coach_log" JSONB NOT NULL DEFAULT '[]';

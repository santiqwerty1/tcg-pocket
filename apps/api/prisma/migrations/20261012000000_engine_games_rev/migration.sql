-- Phase 42: how an engine plays (`gamesRev`): a job is played whole with one, and a game against the bot that cannot go
-- on with the engine there is now ends as `engine_changed`.
ALTER TYPE "LiveGameStatus" ADD VALUE 'engine_changed';
ALTER TABLE "worker_nodes" ADD COLUMN "games_rev" INTEGER;
ALTER TABLE "simulation_jobs" ADD COLUMN "games_rev" INTEGER;
ALTER TABLE "live_games" ADD COLUMN "games_rev" INTEGER;

-- What already played (review of #68): engine-cli 0.3.3 on plays as games revision 1, before it as 0 (`gamesRevOf`).
-- The workers by their last engine, and the jobs whose finished chunks were all played by 0.3.3 or later, are fixed to
-- it now: nothing is played again at the deploy (a job fixed to 0 by a result that did not say its engine would be),
-- and the exact cache keeps its sources. Anything else is left empty, and its first result fixes it.
UPDATE "worker_nodes" SET "games_rev" = CASE
    WHEN (regexp_match("cli_version", '^([0-9]+)\.([0-9]+)\.([0-9]+)'))::int[] >= ARRAY[0, 3, 3] THEN 1 ELSE 0 END
  WHERE "cli_version" ~ '^[0-9]+\.[0-9]+\.[0-9]+';

UPDATE "simulation_jobs" j SET "games_rev" = 1
  WHERE EXISTS (SELECT 1 FROM "simulation_chunks" c WHERE c."job_id" = j."id" AND c."status" = 'done')
    AND NOT EXISTS (
      SELECT 1 FROM "simulation_chunks" c
      WHERE c."job_id" = j."id" AND c."status" = 'done'
        AND (c."cli_version" IS NULL OR c."cli_version" !~ '^[0-9]+\.[0-9]+\.[0-9]+'
          OR (regexp_match(c."cli_version", '^([0-9]+)\.([0-9]+)\.([0-9]+)'))::int[] < ARRAY[0, 3, 3]));

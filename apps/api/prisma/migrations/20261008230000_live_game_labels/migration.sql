-- D-019: the results of the games against the bot travel in the backup; each game keeps its decks' labels.
ALTER TABLE "live_games" ADD COLUMN "human_label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "live_games" ADD COLUMN "rival_label" TEXT NOT NULL DEFAULT '';
UPDATE "live_games" g SET "human_label" = s."label" FROM "deck_snapshots" s WHERE s."id" = g."human_snapshot_id";
UPDATE "live_games" g SET "rival_label" = s."label" FROM "deck_snapshots" s WHERE s."id" = g."bot_snapshot_id";

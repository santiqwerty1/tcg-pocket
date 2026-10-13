-- T-015 (worker en el navegador): who runs a game against the bot. «worker»: a worker claims it (engine-cli); «browser»:
-- the owner's open game page runs it with the WebAssembly engine. The same seed is not the same game on both (R-003),
-- so a game never changes runner.
CREATE TYPE "LiveGameRunner" AS ENUM ('worker', 'browser');

ALTER TABLE "live_games" ADD COLUMN "runner" "LiveGameRunner" NOT NULL DEFAULT 'worker';

-- A browser game keeps the build of the engine that started it (the manifest's `build`): another build of the same
-- source can play another game from the same choices, so a page with another one is told to reload.
ALTER TABLE "live_games" ADD COLUMN "engine_build" TEXT;

-- T-015 (worker en el navegador): who runs a game against the bot. «worker»: a worker claims it (engine-cli); «browser»:
-- the owner's open game page runs it with the WebAssembly engine. The same seed is not the same game on both (R-003),
-- so a game never changes runner.
CREATE TYPE "LiveGameRunner" AS ENUM ('worker', 'browser');

ALTER TABLE "live_games" ADD COLUMN "runner" "LiveGameRunner" NOT NULL DEFAULT 'worker';

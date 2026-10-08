-- Fase 9: who played whom in each round of a tournament (Limitless pairings), for matchups between archetypes.
ALTER TABLE "tournaments" ADD COLUMN "pairings_fetched_at" TIMESTAMPTZ(3);
ALTER TABLE "tournaments" ADD COLUMN "pairings_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "tournament_pairings" (
    "id" SERIAL NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "player1" TEXT NOT NULL,
    "player2" TEXT,
    "result" TEXT NOT NULL,
    CONSTRAINT "tournament_pairings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tournament_pairings_tournament_id_idx" ON "tournament_pairings"("tournament_id");

ALTER TABLE "tournament_pairings" ADD CONSTRAINT "tournament_pairings_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

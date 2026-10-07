-- CreateEnum
CREATE TYPE "match_result" AS ENUM ('win', 'loss', 'tie');

-- CreateEnum
CREATE TYPE "match_mode" AS ENUM ('competitive', 'casual', 'beginner', 'event', 'friend');

-- CreateEnum
CREATE TYPE "match_source" AS ENUM ('ui', 'mcp');

-- CreateTable
CREATE TABLE "matches" (
    "id" SERIAL NOT NULL,
    "deck_id" INTEGER NOT NULL,
    "deck_revision_id" INTEGER NOT NULL,
    "result" "match_result" NOT NULL,
    "opponent_text" TEXT,
    "went_first" BOOLEAN,
    "mode" "match_mode" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "played_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "match_source" NOT NULL DEFAULT 'ui',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matches_deck_id_played_at_idx" ON "matches"("deck_id", "played_at");

-- CreateIndex
CREATE INDEX "matches_played_at_idx" ON "matches"("played_at");

-- CreateIndex
CREATE INDEX "matches_deck_revision_id_idx" ON "matches"("deck_revision_id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_deck_revision_id_fkey" FOREIGN KEY ("deck_revision_id") REFERENCES "deck_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

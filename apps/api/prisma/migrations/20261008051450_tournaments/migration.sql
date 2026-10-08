-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('STANDARD', 'NOEX', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('listed', 'complete', 'incomplete', 'excluded', 'failed');

-- AlterTable
ALTER TABLE "decks" ADD COLUMN     "tournament_archetype_id" TEXT;

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "format_raw" TEXT,
    "format" "TournamentFormat" NOT NULL,
    "players" INTEGER NOT NULL,
    "organizer_id" INTEGER,
    "organizer_name" TEXT,
    "details" JSONB,
    "status" "TournamentStatus" NOT NULL DEFAULT 'listed',
    "excluded_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "raw_standings_gz" BYTEA,
    "standings_sha256" TEXT,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched_at" TIMESTAMPTZ(3),

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_entries" (
    "id" SERIAL NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "player_name" TEXT NOT NULL,
    "country" TEXT,
    "placing" INTEGER,
    "drop" INTEGER,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "ties" INTEGER NOT NULL,
    "archetype_id" TEXT,
    "archetype_name" TEXT,
    "archetype_icons" TEXT[],
    "energies" TEXT[],
    "decklist" JSONB,

    CONSTRAINT "tournament_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_releases" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "release_date" DATE NOT NULL,
    "opens_era" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_releases_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "archetype_aliases" (
    "archetype_id" TEXT NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archetype_aliases_pkey" PRIMARY KEY ("archetype_id")
);

-- CreateTable
CREATE TABLE "limitless_sync_runs" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "calls" INTEGER NOT NULL DEFAULT 0,
    "tournaments_listed" INTEGER NOT NULL DEFAULT 0,
    "tournaments_done" INTEGER NOT NULL DEFAULT 0,
    "waited_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "limitless_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournaments_date_idx" ON "tournaments"("date");

-- CreateIndex
CREATE INDEX "tournaments_status_date_idx" ON "tournaments"("status", "date");

-- CreateIndex
CREATE INDEX "tournament_entries_archetype_id_idx" ON "tournament_entries"("archetype_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_entries_tournament_id_player_id_key" ON "tournament_entries"("tournament_id", "player_id");

-- CreateIndex
CREATE INDEX "limitless_sync_runs_started_at_idx" ON "limitless_sync_runs"("started_at");

-- AddForeignKey
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Era table seeded with the releases of PLAN Apéndice A.5 (pocket.limitlesstcg.com, 6/10/2026). The owner edits it;
-- new databases get the same rows here, so the catalog sync does not have to know about eras (DECISIONES 5.2).
INSERT INTO "set_releases" ("code", "name_en", "release_date", "opens_era") VALUES
  ('A1', 'Genetic Apex', DATE '2024-10-30', true),
  ('A1a', 'Mythical Island', DATE '2024-12-17', true),
  ('A2', 'Space-Time Smackdown', DATE '2025-01-29', true),
  ('A2a', 'Triumphant Light', DATE '2025-02-28', true),
  ('A2b', 'Shining Revelry', DATE '2025-03-27', true),
  ('A3', 'Celestial Guardians', DATE '2025-04-30', true),
  ('A3a', 'Extradimensional Crisis', DATE '2025-05-29', true),
  ('A3b', 'Eevee Grove', DATE '2025-06-26', true),
  ('A4', 'Wisdom of Sea and Sky', DATE '2025-07-30', true),
  ('A4a', 'Secluded Springs', DATE '2025-08-28', true),
  ('A4b', 'Deluxe Pack: ex', DATE '2025-09-30', false),
  ('B1', 'Mega Rising', DATE '2025-10-30', true),
  ('B1a', 'Crimson Blaze', DATE '2025-12-17', true),
  ('B2', 'Fantastical Parade', DATE '2026-01-29', true),
  ('B2a', 'Paldean Wonders', DATE '2026-02-26', true),
  ('B2b', 'Mega Shine', DATE '2026-03-26', true),
  ('B3', 'Pulsing Aura', DATE '2026-04-28', true),
  ('B3a', 'Paradox Drive', DATE '2026-05-28', true),
  ('B3b', 'Everyday Wonders', DATE '2026-06-30', true),
  ('B4', 'Ruler of the Skies', DATE '2026-07-30', true),
  ('B4a', 'Team Rocket''s Ambition', DATE '2026-08-27', true),
  ('B4b', 'Deluxe Pack: Mega', DATE '2026-09-30', false)
ON CONFLICT ("code") DO NOTHING;

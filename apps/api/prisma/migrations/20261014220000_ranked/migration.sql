-- 14/10/2026: ranked by season and rank (pedido de Santi). Two new tables; nothing else changes.
CREATE TABLE "ranked_seasons" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranked_seasons_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "rank_changes" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "rank" TEXT NOT NULL,
    "points" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rank_changes_at_idx" ON "rank_changes"("at");

-- The seasons known on 14/10 (Game8, Bulbapedia); the owner can correct them from the app.
INSERT INTO "ranked_seasons" ("code", "name", "starts_on", "ends_on") VALUES
    ('B4a', 'Temporada B4a', '2026-09-15', '2026-09-29'),
    ('B4bSP', 'Temporada B4b SP', '2026-10-14', '2026-10-28');

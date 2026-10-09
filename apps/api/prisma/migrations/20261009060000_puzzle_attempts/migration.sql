-- Fase 24: practice on the owner's own mistakes («situaciones para resolver»): one row per situation tried.
CREATE TABLE "puzzle_attempts" (
    "game_id" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "solved" BOOLEAN NOT NULL DEFAULT false,
    "last_verdict" TEXT,
    "last_at" TIMESTAMPTZ(3),

    CONSTRAINT "puzzle_attempts_pkey" PRIMARY KEY ("game_id","step")
);

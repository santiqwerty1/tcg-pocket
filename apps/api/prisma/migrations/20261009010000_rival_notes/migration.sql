-- Fase 12: notes on how to play against each rival.
CREATE TABLE "rival_notes" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "archetype_id" TEXT,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rival_notes_pkey" PRIMARY KEY ("key")
);

-- Fase 30: each answer to a calculation exercise (practice data; not in the backup, like the situations).
CREATE TABLE "drill_attempts" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "deck_id" INTEGER,
    "seed" BIGINT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drill_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "drill_attempts_created_at_idx" ON "drill_attempts"("created_at");

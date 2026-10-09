-- Fase 28: a match saved on the phone without signal carries its own id, so sending it twice stores it once.
ALTER TABLE "matches" ADD COLUMN "client_ref" TEXT;
CREATE UNIQUE INDEX "matches_client_ref_key" ON "matches"("client_ref");

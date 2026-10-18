-- 14/10/2026: the rival's cards seen in a match (pedido de Santi). A constant default: Postgres adds the column without
-- rewriting the table, and every match already logged gets `[]` (nothing changes for them).
ALTER TABLE "matches" ADD COLUMN "opponent_cards" JSONB NOT NULL DEFAULT '[]';

-- Where each participant starts in a room it joined later (review of #88): room → the last message id when it joined.
-- What came before counts as read, as `since_id` does for a new participant. A constant default: Postgres adds the
-- column without rewriting the table, and the memberships of today keep reading from their `since_id`.
ALTER TABLE "session_chat_participants" ADD COLUMN "room_since" JSONB NOT NULL DEFAULT '{}'::jsonb;

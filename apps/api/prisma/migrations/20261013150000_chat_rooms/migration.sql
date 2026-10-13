-- Rooms in the chat between sessions (Santi, 13/10/2026): «tcg», this app's sessions and every message so far, and
-- «posta», the Posta project's coordinator and its Codex. Ids stay global and serialized, so the bridge keeps reading
-- «after» an id, one position per room.
ALTER TABLE "session_chat_messages" ADD COLUMN "room" TEXT NOT NULL DEFAULT 'tcg';
CREATE INDEX "session_chat_messages_room_id_idx" ON "session_chat_messages"("room", "id");

-- The rooms of each participant, its main one first: an MCP call without «sala» goes there (an open cloud session
-- keeps the tools it started with, and does not know the parameter). Santi is in all of them, «tcg» first.
ALTER TABLE "session_chat_participants" ADD COLUMN "rooms" TEXT[] NOT NULL DEFAULT ARRAY['tcg']::TEXT[];

-- Posta's coordinator (a cloud session) and its Codex (at the PC, through the bridge): «posta» first, and «tcg» too
-- while the dispatcher still reads the tcg room. A name already in the list keeps its channel.
INSERT INTO "session_chat_participants" ("key", "name", "channel", "rooms", "since_id")
SELECT v.key, v.name, v.channel::"session_chat_channel", ARRAY['posta', 'tcg']::TEXT[],
    COALESCE((SELECT max("id") FROM "session_chat_messages"), 0)
FROM (VALUES ('posta-coordinador', 'Posta-Coordinador', 'connector'), ('codex-posta', 'Codex-Posta', 'relay'))
    AS v(key, name, channel)
ON CONFLICT ("key") DO UPDATE SET "rooms" = ARRAY['posta', 'tcg']::TEXT[];

-- Chat between the Claude sessions that work on the app's code (D-021): the bridge between the chat file on Santi's
-- PC and the cloud sessions, which only reach the app through its MCP. Development chatter, not Santi's data: not in
-- the backup. Inserts are serialized (an advisory lock), so ids commit in order and the bridge can read `after` an id.
CREATE TABLE "session_chat_messages" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_name" TEXT NOT NULL,
    "from_key" TEXT NOT NULL,
    "to_names" TEXT[],
    "to_keys" TEXT[],
    "topic" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "token_id" INTEGER,
    -- How it arrived: the API token's name.
    "via" TEXT NOT NULL DEFAULT '',
    -- The bridge's own id for a message it copied from the PC: sending it again does not duplicate it.
    "relay_ref" TEXT,

    CONSTRAINT "session_chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "session_chat_messages_relay_ref_key" ON "session_chat_messages"("relay_ref");
CREATE INDEX "session_chat_messages_at_idx" ON "session_chat_messages"("at");
CREATE INDEX "session_chat_messages_to_keys_idx" ON "session_chat_messages" USING GIN ("to_keys");

-- Which messages each participant (by its key, the name in lower case) has already read. A set, not a watermark: it
-- does not depend on the order in which ids commit.
CREATE TABLE "session_chat_seen" (
    "participant" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_chat_seen_pkey" PRIMARY KEY ("participant","message_id")
);
-- For the cascade when the retention deletes old messages.
CREATE INDEX "session_chat_seen_message_id_idx" ON "session_chat_seen"("message_id");
-- Who takes part (decision of Santi, 09/10/2026): `from`, `to` and `as` must be one of these names exactly (only
-- the case does not matter: `key` is the name in lower case), and each writes only from its channel: `owner`, Santi
-- (his session or the bridge); `relay`, a session at the PC (the bridge); `connector`, a cloud session (the MCP).
CREATE TYPE "session_chat_channel" AS ENUM ('owner', 'relay', 'connector');

CREATE TABLE "session_chat_participants" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "session_chat_channel" NOT NULL,
    -- A participant added later starts after this message: what came before counts as read.
    "since_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_chat_participants_pkey" PRIMARY KEY ("key")
);

INSERT INTO "session_chat_participants" ("key", "name", "channel") VALUES
    ('santi', 'Santi', 'owner'),
    ('coordinador', 'Coordinador', 'relay'),
    ('principal', 'Principal', 'relay'),
    ('laboratorio', 'Laboratorio', 'relay'),
    ('infra', 'Infra', 'relay'),
    ('nube-mejoras', 'Nube-Mejoras', 'connector'),
    ('nube-2', 'Nube-2', 'connector');

ALTER TABLE "session_chat_seen" ADD CONSTRAINT "session_chat_seen_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "session_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

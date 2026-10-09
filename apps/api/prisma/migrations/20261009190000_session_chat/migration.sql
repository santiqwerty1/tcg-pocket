-- Chat between the Claude sessions that work on the app's code (D-021): the cloud sessions only reach the app
-- through its MCP. Development chatter, not Santi's data: not in the backup.
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

    CONSTRAINT "session_chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "session_chat_messages_at_idx" ON "session_chat_messages"("at");
CREATE INDEX "session_chat_messages_to_keys_idx" ON "session_chat_messages" USING GIN ("to_keys");

-- Which messages each participant (by its key: «Nube 2» and «nube2» are the same) has already read. A set, not a
-- watermark: with concurrent writers ids can commit out of order, and a watermark would skip the late one.
CREATE TABLE "session_chat_seen" (
    "participant" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_chat_seen_pkey" PRIMARY KEY ("participant","message_id")
);
ALTER TABLE "session_chat_seen" ADD CONSTRAINT "session_chat_seen_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "session_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

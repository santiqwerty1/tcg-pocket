/**
 * `pg_advisory_xact_lock` key that serializes the chat's inserts (chat.service.ts), the import (chat-transfer.service.ts)
 * and Santi's switch of a moved room (chat-moved.service.ts): any constant no other lock uses.
 */
export const CHAT_WRITE_LOCK = 20_261_009

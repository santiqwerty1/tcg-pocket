-- The last sign of life of a running catalog sync (the low of #75): the process running it renews it every 30 s, and
-- the API closes one without it for 5 minutes as interrupted. A sync whose process died (a CLI cut in `flyctl machine
-- exec`) no longer stays «running» until the next restart of the API. Nullable, without a default: no rewrite.
ALTER TABLE "catalog_syncs" ADD COLUMN "heartbeat_at" TIMESTAMPTZ(3);

-- What a worker runs on (`process.platform`: android, win32, linux), from worker 0.3.5; and when its pause episode
-- began (lost results, DECISIONES 51.26): it lasts until the worker delivers a result again, so the alert, and its
-- push, is one per episode and not one per pause.
ALTER TABLE "worker_nodes" ADD COLUMN "platform" TEXT;
ALTER TABLE "worker_nodes" ADD COLUMN "paused_since" TIMESTAMPTZ(3);

-- D-025: whether a worker takes the slow bots (m, e3 and up, f3 and up, every g), as its last claim said, so the
-- worker_idle alert sees a job that only workers turning them down are left to take (review of #142). Workers that
-- do not say it take every bot, as the claim reads them: true until their next claim.
ALTER TABLE "worker_nodes" ADD COLUMN "allow_slow_bots" BOOLEAN NOT NULL DEFAULT true;

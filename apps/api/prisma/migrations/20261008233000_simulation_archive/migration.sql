-- Finished simulations can be archived: hidden from the list, their results still count.
ALTER TABLE "simulation_jobs" ADD COLUMN "archived_at" TIMESTAMPTZ(3);

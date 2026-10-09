-- What each worker's engine can do (engine-cli version features), reported from worker 0.2.6 on.
ALTER TABLE "worker_nodes" ADD COLUMN "engine_features" TEXT[] DEFAULT ARRAY[]::TEXT[];

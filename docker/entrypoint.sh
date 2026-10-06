#!/bin/sh
# Container entrypoint: apply pending migrations, then start the API (PID 1 via exec for clean signals).
set -eu
cd /app/apps/api
echo "[entrypoint] prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy
echo "[entrypoint] starting api"
exec node dist/main.js

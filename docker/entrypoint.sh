#!/bin/sh
# Container entrypoint: apply pending migrations, then start the API (PID 1 via exec for clean signals).
# With arguments (Fly's release_command may come through here), it runs them instead.
set -eu
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
cd /app/apps/api
echo "[entrypoint] prisma migrate deploy"
# Fly's release_command already ran them and stopped the deploy if they failed. Here a failure (a migration left
# marked as failed, P3009) must not keep the app down on every restart: log it and start anyway
# (docs/OPERACION.md, «Una migración que falló»).
node node_modules/prisma/build/index.js migrate deploy || echo "[entrypoint] migrate deploy falló: arranco igual (ver docs/OPERACION.md)"
echo "[entrypoint] starting api"
exec node dist/main.js

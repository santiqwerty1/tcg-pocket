#!/bin/sh
# Fly's release_command (fly.toml, Fase 38): apply pending migrations before the new version starts.
set -eu
cd /app/apps/api
echo "[release] prisma migrate deploy"
exec node node_modules/prisma/build/index.js migrate deploy

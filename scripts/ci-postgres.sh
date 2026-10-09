#!/usr/bin/env bash
# CI (D-023): a Postgres 17 on 127.0.0.1:5433 for the e2e and the screens. On the owner's PC the repository's
# docker compose one is already running (and starting it again from the runner's folder would clash on the container
# name), so it is used as it is; on GitHub's runners it is started from docker-compose.yml.
set -euo pipefail

ready() {
  node -e "require('net').connect(5433, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"
}

if ready; then
  echo "Postgres ya corre en 127.0.0.1:5433"
  exit 0
fi
docker compose up -d --wait postgres
for _ in $(seq 1 30); do
  if ready; then
    echo "Postgres listo en 127.0.0.1:5433"
    exit 0
  fi
  sleep 1
done
echo "Postgres no respondió en 127.0.0.1:5433" >&2
exit 1

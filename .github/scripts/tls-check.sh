#!/usr/bin/env bash
# TLS of the image's migrations (prisma.config.ts, the same check as chat-hub's H6.12), run by the CI's docker job: a
# Postgres with a certificate of a throwaway CA and one of a foreign CA (a MITM). The release_command with
# sslmode=verify-full and that CA has to migrate the first and refuse the second. Files go in with `docker cp`, so it
# does not depend on mounting folders (a Windows runner).
# Usage: .github/scripts/tls-check.sh <image> <docker network> <prefix>
set -euo pipefail
trap 'echo "FAIL the TLS check stopped at line $LINENO" >&2' ERR
# Git Bash converts what looks like a POSIX path: off only for docker, whose container paths must go as they are
# (an inherited MSYS_NO_PATHCONV would break openssl's temporary paths). Never for the subjects of openssl ("/CN=…"),
# which are not paths. Neither does anything off Git Bash.
unset MSYS_NO_PATHCONV
d() { MSYS_NO_PATHCONV=1 docker "$@"; }
export MSYS2_ARG_CONV_EXCL="/CN"
IMAGE="$1"
NET="$2"
PREFIX="$3"
# The throwaway Postgres' password, in a variable: a URL with a written password reads as a real one.
PGPASS=tls
GOOD="$PREFIX-tls-good"
BAD="$PREFIX-tls-bad"
DIR="$(mktemp -d)"
host() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
cleanup() {
  d rm -f "$GOOD" "$BAD" "$PREFIX-tls-migrate" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT
cleanup
DIR="$(mktemp -d)"

# Our CA and a certificate for $GOOD; a foreign CA and a certificate for $BAD (valid name, wrong CA).
cert() { # name ca-key ca-crt out
  openssl req -newkey rsa:2048 -nodes -keyout "$DIR/$4.key" -out "$DIR/$4.csr" -subj "/CN=$1" 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$1" > "$DIR/$4.ext"
  openssl x509 -req -in "$DIR/$4.csr" -CA "$DIR/$3" -CAkey "$DIR/$2" -CAcreateserial -out "$DIR/$4.crt" -days 1 \
    -extfile "$DIR/$4.ext" 2>/dev/null
}
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/ca.key" -out "$DIR/ca.crt" -days 1 -subj "/CN=CI CA" 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/other.key" -out "$DIR/other.crt" -days 1 -subj "/CN=Otra CA" 2>/dev/null
cert "$GOOD" ca.key ca.crt good
cert "$BAD" other.key other.crt bad

postgres_tls() { # name cert-file-prefix
  d create --name "$1" --network "$NET" -e POSTGRES_USER=tls -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=tls \
    postgres:17-alpine sh -c 'chown postgres:postgres /tmp/server.crt /tmp/server.key && chmod 600 /tmp/server.key \
      && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key' \
    >/dev/null
  d cp "$(host "$DIR/$2.crt")" "$1:/tmp/server.crt"
  d cp "$(host "$DIR/$2.key")" "$1:/tmp/server.key"
  d start "$1" >/dev/null
}
postgres_tls "$GOOD" good
postgres_tls "$BAD" bad
for attempt in $(seq 1 60); do
  if d exec "$GOOD" pg_isready -h 127.0.0.1 -U tls -d tls >/dev/null 2>&1 \
    && d exec "$BAD" pg_isready -h 127.0.0.1 -U tls -d tls >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 2

# The release_command as in production (NODE_ENV=production, sslmode=verify-full), trusting only our CA.
migrate() { # host
  d rm -f "$PREFIX-tls-migrate" >/dev/null 2>&1 || true
  d create --name "$PREFIX-tls-migrate" --network "$NET" -e NODE_ENV=production -e NODE_EXTRA_CA_CERTS=/tmp/ca.crt \
    -e DATABASE_URL="postgresql://tls:$PGPASS@$1:5432/tls?sslmode=verify-full" "$IMAGE" /app/migrate.sh >/dev/null
  d cp "$(host "$DIR/ca.crt")" "$PREFIX-tls-migrate:/tmp/ca.crt"
  d start -a "$PREFIX-tls-migrate" >"$DIR/migrate.log" 2>&1
}
if migrate "$GOOD" && grep -Eq 'successfully applied|No pending migrations' "$DIR/migrate.log"; then
  echo "ok   the migrations go through TLS with the trusted CA"
else
  echo "FAIL the migrations did not go through with the trusted CA" && tail -5 "$DIR/migrate.log" && exit 1
fi
# Refused for its certificate (P1011), not for anything else: a server that is down or a wrong password also fail.
if migrate "$BAD"; then
  echo "FAIL the migrations accepted a server of a foreign CA" && tail -5 "$DIR/migrate.log" && exit 1
elif grep -q 'P1011' "$DIR/migrate.log"; then
  echo "ok   a server of a foreign CA is refused: $(grep -oE 'P1011[^.]*' "$DIR/migrate.log" | head -1)"
else
  echo "FAIL the migrations failed with a foreign CA, but not for its certificate" && tail -5 "$DIR/migrate.log" && exit 1
fi

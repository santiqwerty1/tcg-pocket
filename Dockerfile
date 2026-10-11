# syntax=docker/dockerfile:1.7
# Single image for Fly.io: builds @tcg/domain, the PWA and the API, then runs `prisma migrate deploy` + the API.

FROM node:24-alpine AS base
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN apk add --no-cache libc6-compat && npm install -g pnpm@12.9.1
WORKDIR /app

# --- Worker engines: same pinned source/lock as every other worker (T-015, D-026) ---------------------------------
# Android (aarch64 musl) and Windows (x86_64 GNU, the PCs' update package) cross-compiled with zig, plus the native
# reference engine whose games both packages must reproduce. The Windows build gives the same games as the PC's
# native one (checked on 11/10/2026 with r, e2, f2 and e3).
FROM rust:1.99.0-slim-bookworm AS worker-engines
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv gcc libc6-dev ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /tools \
 && /tools/bin/pip install --no-cache-dir ziglang==0.13.0 cargo-zigbuild==0.23.4 \
 && rustup target add aarch64-unknown-linux-musl x86_64-pc-windows-gnu
ENV PATH=/tools/bin:$PATH
WORKDIR /engine
COPY engine/Cargo.toml engine/Cargo.lock engine/build.rs ./
# The Windows stack reservation (deckgym's card database needs more than the default).
COPY engine/.cargo ./.cargo
COPY engine/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/engine/target \
    cargo zigbuild --locked --release --target aarch64-unknown-linux-musl \
 && cargo zigbuild --locked --release --target x86_64-pc-windows-gnu \
 && cargo build --locked --release \
 && mkdir /engine-out \
 && cp target/aarch64-unknown-linux-musl/release/engine-cli /engine-out/engine-cli \
 && cp target/x86_64-pc-windows-gnu/release/engine-cli.exe /engine-out/engine-cli.exe \
 && cp "$(python3 -c 'import os, ziglang; print(os.path.dirname(ziglang.__file__))')/lib/libc/mingw/COPYING" /engine-out/LICENSE-mingw-w64.txt \
 && cp target/release/engine-cli /engine-out/reference-engine \
 && cp "$(rustc --print sysroot)/share/doc/rust/COPYRIGHT-library.html" /engine-out/COPYRIGHT-library.html \
 && cp -r "$(rustc --print sysroot)/share/doc/rust/licenses" /engine-out/licenses \
 && cargo vendor --locked --versioned-dirs /engine-out/vendor > /engine-out/vendor-config.toml \
 && sed -i 's|directory = "/engine-out/vendor"|directory = "vendor"|' /engine-out/vendor-config.toml

# --- dependencies (native modules such as argon2 may need a toolchain on Alpine) ---------------------------------
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
# `apps/api` runs `prisma generate` on postinstall: it needs the schema (and prisma.config.ts) before `pnpm install`.
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile

# Package built on the remote Fly builder as part of the same image; no release login/token on the phone.
FROM deps AS android-package
COPY apps/worker apps/worker
COPY LICENSE tsconfig.base.json ./
COPY engine engine
COPY --from=worker-engines /engine-out /engine-out
RUN node apps/worker/scripts/package-android.mjs --engine /engine-out/engine-cli \
    --reference-engine /engine-out/reference-engine --vendor /engine-out/vendor --runtime-licenses /engine-out --out /android-package

# The PCs' update package (D-026): worker.cjs, engine-cli.exe and its determinism reference, ~4 MB (no Node inside).
FROM deps AS windows-package
COPY apps/worker apps/worker
COPY LICENSE tsconfig.base.json ./
COPY --from=worker-engines /engine-out /engine-out
RUN node apps/worker/scripts/package-windows-update.mjs --engine /engine-out/engine-cli.exe \
    --reference-engine /engine-out/reference-engine --runtime-licenses /engine-out --out /windows-package

# --- deckgym replay viewer (D-014): built unmodified at the engine's pinned commit ------------------------------
FROM node:24-alpine AS viewer
RUN apk add --no-cache git
WORKDIR /viewer
COPY engine/Cargo.toml Cargo.toml
RUN REV="$(sed -n 's/^deckgym = .*rev = "\([0-9a-f]\{40\}\)".*/\1/p' Cargo.toml)" \
 && test -n "$REV" \
 && git init -q src && cd src \
 && git fetch -q --depth 1 https://github.com/bcollazo/deckgym-core "$REV" && git checkout -q FETCH_HEAD \
 && cd viewer && npm ci --no-audit --no-fund --loglevel=error \
 && npx vite build --base=/viewer/ --outDir /viewer/dist --emptyOutDir

# --- build ------------------------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
COPY --from=viewer /viewer/dist apps/web/public/viewer
RUN pnpm -F @tcg/domain build \
 && pnpm -F @tcg/api db:generate \
 && pnpm -F @tcg/web build \
 && pnpm -F @tcg/api build \
 && rm -rf node_modules apps/api/node_modules apps/web/node_modules packages/domain/node_modules \
 && pnpm install --prod --frozen-lockfile --offline --ignore-scripts --filter "@tcg/api..."
# The last step re-links, from the local store, only the production dependencies of the API and of @tcg/domain
# (`--prod` on the existing node_modules leaves the dev packages in the virtual store; the PWA's runtime deps are not
# needed either: the API serves its built `dist`). argon2 ships musl prebuilds, so `--ignore-scripts` is fine.

# --- runtime ----------------------------------------------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/apps/web/dist
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /app/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/prisma.config.ts ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/certs ./apps/api/certs
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=android-package --chown=node:node /android-package/android-arm64.tar.gz /android-package/android-version.json /android-package/install-android.sh ./apps/worker/build/
COPY --from=windows-package --chown=node:node /windows-package/windows-x64.tar.gz /windows-package/windows-x64-version.json ./apps/worker/build/
COPY --chown=node:node docker/entrypoint.sh ./entrypoint.sh
COPY --chown=node:node docker/migrate.sh ./migrate.sh
RUN chmod +x /app/entrypoint.sh /app/migrate.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]

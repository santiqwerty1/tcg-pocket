# syntax=docker/dockerfile:1.7
# Single image for Fly.io: builds @tcg/domain, the PWA and the API, then runs `prisma migrate deploy` + the API.

FROM node:24-alpine AS base
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN apk add --no-cache libc6-compat && npm install -g pnpm@12.9.1
WORKDIR /app

# --- dependencies (native modules such as argon2 may need a toolchain on Alpine) ---------------------------------
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
# `apps/api` runs `prisma generate` on postinstall: it needs the schema (and prisma.config.ts) before `pnpm install`.
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
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
COPY --chown=node:node docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]

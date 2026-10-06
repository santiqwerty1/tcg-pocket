# @tcg/api

Proceso único de NestJS 12 (Express 5, ESM) que sirve la API REST, la PWA compilada (`apps/web/dist`) detrás de la sesión, los endpoints con token para el worker y el conector MCP, y los jobs programados. Base de datos Postgres con Prisma 7 (`@prisma/adapter-pg`). Plan y decisiones: `docs/PLAN.md` §2, §3.1, §3.9, §4; `docs/DECISIONES.md`. Contrato REST: `docs/API.md`.

## Requisitos

- Node 24, pnpm 12 (`corepack` o `npm i -g pnpm`).
- Docker para el Postgres local (`docker-compose.yml` en la raíz).
- `@tcg/domain` compilado: `pnpm -F @tcg/domain build` (la API lo resuelve por `dist/`).
- Cliente de Prisma generado: lo hace `postinstall` (`prisma generate`); a mano, `pnpm -F @tcg/api db:generate`.

## Variables de entorno

Se validan al arrancar (`src/config/env.ts`, zod); si falta algo el proceso termina con un mensaje por variable. Fuera de producción se carga el `.env` de la raíz del repo sin pisar variables ya definidas (`src/config/dotenv.ts`, sin dependencias: `util.parseEnv`). En producción todo viene de `fly secrets` / `[env]` de `fly.toml`.

| Variable | Obligatoria | Default | Uso |
|---|---|---|---|
| `DATABASE_URL` | sí | — | `postgresql://…`. Local: `postgresql://tcg:tcg@127.0.0.1:5433/tcg` (usar `127.0.0.1`, no `localhost`: el motor de Prisma resuelve `localhost` por IPv6 y Docker en Windows no responde ahí). |
| `SESSION_SECRET` | sí | — | ≥ 32 caracteres aleatorios. Deriva (HKDF) la clave AES-256-GCM que cifra el secreto TOTP en reposo. Cambiarlo invalida el TOTP guardado (hay que correr `owner:init` de nuevo). |
| `TEST_DATABASE_URL` | para `test:e2e` | — | Base aparte en el mismo servidor (`…/tcg_test`). |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | para `owner:init` | — | Credenciales iniciales (contraseña ≥ 12 caracteres). |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production`. |
| `PORT` | no | `3000` | Puerto HTTP. |
| `WEB_DIST` | no | `../web/dist` (relativo a `apps/api`) | Carpeta de la PWA compilada. Si no existe, `/` muestra un aviso. |
| `CATALOG_COMMIT` | no | `3ab58f1cec6a03e3e85455cf7aade3bb8561f92e` | Pin del tracker para `catalog:sync`. |
| `ENGINE_REV` | no | `fb792ebfbaca995af9750c28101ce92a51282825` | Pin de deckgym-core. |
| `COOKIE_SECURE` | no | `true` en producción, `false` si no | Cookie `__Host-session` + `Secure` + HSTS; en desarrollo `tcg_session` sin `Secure`. |
| `TRUST_PROXY` | no | `1` | Saltos de proxy confiables (`X-Forwarded-For`): 1 en Fly. |
| `LOG_LEVEL` | no | `info` en producción, `debug` si no | Nivel de pino (`silent` apaga). |
| `APP_VERSION` | no | versión de `package.json` | Lo que informa `/healthz`. |

## Base de datos local

```bash
docker compose up -d                 # Postgres 17 en 127.0.0.1:5433 (usuario/clave/db: tcg)
cp .env.example .env                 # y completar SESSION_SECRET con algo largo y aleatorio
pnpm -F @tcg/domain build
pnpm -F @tcg/api db:migrate          # aplica prisma/migrations (y crea una nueva si cambió schema.prisma)
```

Scripts de Prisma (`prisma.config.ts` lee `DATABASE_URL`):

- `db:migrate`: `prisma migrate dev` (desarrollo; crea migraciones a partir de `prisma/schema.prisma`).
- `db:deploy`: `prisma migrate deploy` (producción; lo corre el contenedor al arrancar).
- `db:generate`: regenera el cliente en `src/generated/prisma` (ignorado por git; también corre en `postinstall`).
- `db:reset`: **borra** la base y reaplica todo (solo desarrollo).

La migración inicial (`prisma/migrations/*_init`) incluye pasos a mano: índice único parcial de ajustes activos, `CHECK` de cantidades y de la fila única de `owner`. Las extensiones `pg_trgm`/`unaccent` y el índice GIN sobre `cards.search_text` los genera Prisma (`postgresqlExtensions`).

## Primer uso

```bash
OWNER_EMAIL=... OWNER_PASSWORD=... pnpm -F @tcg/api owner:init   # imprime el secreto TOTP y la URI otpauth:// una sola vez
pnpm -F @tcg/api catalog:sync                                   # baja el catálogo al commit fijado (o --from-fixtures sin red)
pnpm -F @tcg/api start                                          # o start:dev; luego http://localhost:3000/login
```

### `owner:init [--no-totp]`

Crea o actualiza al único usuario (fila `owner` con `id = 1`): contraseña con argon2id y, salvo `--no-totp`, un secreto TOTP nuevo (se guarda cifrado; se muestra en consola una sola vez junto con la URI para la app de autenticación y el código actual para verificar el reloj). Cierra todas las sesiones abiertas. Volver a correrlo rota el secreto TOTP: hay que re-enrolar la app.

### `catalog:sync [--commit <sha>] [--engine-rev <sha>] [--from-fixtures]`

Baja los ocho archivos del tracker (`raw.githubusercontent.com`, commit fijado) y `database.json` de deckgym, calcula sha256 de cada uno, construye el catálogo con `@tcg/domain` (`buildCatalogWithReport`), lo compara con el cargado (`diffCatalog`) y lo escribe entero en una transacción (upsert completo: expansiones, sobres, grupos funcionales, cartas, `pack_cards`, alias de evolución; siembra `rarity_rules` sin pisar valores existentes). Registra una fila en `catalog_syncs` (estado, conteos, hashes, informe, diff) y los cambios por carta en `catalog_sync_changes`. Al terminar recarga el índice en memoria. `--from-fixtures` lee `packages/domain/test/fixtures` (offline; es lo que usan los tests). Salida: JSON con el resumen; código 2 si quedó en `needs_review`.

Pendiente (I12): cuando cambian unidades de stock o grupos y ya hay colección/mazos, el sync aplica el catálogo y queda en `needs_review` con un aviso; el remapeo automático de colección, ajustes y mazos no está implementado todavía.

## Rutas y exposición

Sigue `docs/API.md`. Errores siempre como `{ error: { code, message, details? } }` (`validation`, `unauthenticated`, `invalid_credentials`, `totp_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `not_implemented`, `unavailable`…). Todo exige la cookie de sesión salvo lo marcado. Las navegaciones sin sesión (GET fuera de `/api`, también chunks y manifest) redirigen 302 a `/login`; las llamadas a `/api/*`, los métodos no-GET y los clientes que piden JSON reciben `401 { error: { code: 'unauthenticated' } }`.

| Ruta | Acceso | Qué hace |
|---|---|---|
| `GET /healthz` | pública | `{ ok, version, catalogCommit, engineRev }` (health check de Fly). |
| `GET /login` | pública | Página de ingreso autocontenida (correo, contraseña, código de 6 dígitos). Con sesión redirige a `/`. |
| `POST /api/auth/login` | pública, 5 intentos / 15 min por IP (429 al 6.º) | `{ email, password, totp? }` → `204` + cookie de sesión. |
| `POST /api/auth/logout` | sesión | `204`; borra la sesión y la cookie. |
| `GET /api/auth/me` | sesión | `{ email, totpEnabled }`. |
| `POST /api/auth/password` | sesión | `{ currentPassword, newPassword }` → `204`; cierra las demás sesiones. |
| `GET /api/tokens` | sesión | `{ items: [{ id, name, kind, scopes, prefix, createdAt, lastUsedAt, expiresAt, revokedAt }] }`. |
| `POST /api/tokens` | sesión | `{ name, kind: 'worker' \| 'mcp', scopes }` → `201 { id, token, … }` (el token en claro, una sola vez). |
| `DELETE /api/tokens/:id` | sesión | Revoca → `204`. |
| `GET /api/catalog/status` | sesión | `{ loaded, trackerCommit, engineRev, syncedAt, pinned, counts, lastSync: { id, status, source, startedAt, finishedAt, report, error } }`. |
| `POST /api/catalog/sync` | sesión | `{ commit?, engineRev?, fromFixtures? }` → `202 { syncId }`; corre en segundo plano; 409 si ya hay uno. |
| `GET /api/expansions` | sesión | `{ items: Expansion[] }` con `packs` (sin `cardIds`). |
| `GET /api/cards?q=&lang=&limit=20` | sesión | `{ items: [{ card: CardSummary, group: GroupSummary, score, matchedOn }] }`; `?expansion=A1` → `{ items: CardSummary[], total }`. |
| `GET /api/cards/:id` | sesión | `{ card: CardEdition, group: GroupDetail }`. |
| `GET /api/groups/:id` | sesión | `{ group: GroupDetail }` (`playable`, `fromStock`, `adjustment`, `editions[{ card, owned, collected, twinCardIds }]`, `decks`). |
| `/api/worker/*` | bearer `tcg_wk_*` con `worker:claim` | Stub: `GET /api/worker/ping`. |
| `/api/mcp` | bearer `tcg_mcp_*` con `mcp:read` | Stub: 501 hasta la Fase 3. |
| `/.well-known/*` | pública | 404 por ahora (reservado para OAuth si hiciera falta). |
| resto (`/`, `/assets/*`, `/sw.js`, `/manifest.webmanifest`…) | sesión | Estáticos de `WEB_DIST` (`/assets/*` inmutable; shell, sw y manifest `no-store`) y fallback a `index.html`. |

Sesiones: id aleatorio de 32 bytes en la cookie, SHA-256 en `sessions`; 30 días deslizantes (se extienden cuando pasó más de un día desde `last_seen_at`); `HttpOnly; SameSite=Lax; Path=/` (+ `Secure`). Cabeceras de seguridad en todas las respuestas (CSP, `nosniff`, `frame-ancestors 'none'`, HSTS con `COOKIE_SECURE`). Cuerpos JSON hasta 10 MB.

## Tokens de API

`POST /api/tokens` con `{ name, kind: 'worker' | 'mcp', scopes }` devuelve el token en claro **una sola vez** (`tcg_wk_…` / `tcg_mcp_…` = prefijo + 32 bytes aleatorios en base64url); en la base queda solo el SHA-256, el prefijo para mostrar, `last_used_at` y `revoked_at`. Scopes: `worker:claim` (worker), `mcp:read`, `mcp:write` (MCP). `DELETE /api/tokens/:id` revoca. El guard (`src/tokens/bearer-token.guard.ts`) responde 401 sin token válido y 403 sin el scope.

## Tests

```bash
pnpm -F @tcg/api test        # unitarios (vitest): env, cookies, cifrado, tokens, reglas de exposición, envoltorio de errores, página de login
pnpm -F @tcg/api test:e2e    # supertest contra TEST_DATABASE_URL
```

Los e2e (`test/*.e2e-spec.ts`, `vitest.config.e2e.ts`) crean la base de prueba si no existe, aplican `prisma migrate deploy` y truncan todas las tablas (`test/global-setup.ts`); corren de a un archivo. Cubren exposición y cabeceras, login/TOTP/throttle/logout/expiración deslizante/cambio de contraseña, tokens y guard bearer, y el catálogo (sync desde fixtures: 4.317 cartas, «Copiona» y «Copycat» dan el mismo grupo `B1-225`, `A4b-1` comparte unidad de stock con `A1-1`, detalle de grupo con stock/ajuste/mazos, re-sync por HTTP con diff vacío).

## Deploy (Fly.io)

- `Dockerfile` (raíz): multi-stage con pnpm; compila `@tcg/domain`, genera el cliente de Prisma, compila la PWA y la API; imagen final `node:24-alpine` con `WEB_DIST=/app/apps/web/dist`. `docker/entrypoint.sh` corre `prisma migrate deploy` y arranca `node dist/main.js`.
- `fly.toml`: app `tcg-pocket`, región `gru`, puerto interno 3000, `force_https`, `auto_stop_machines = false`, `min_machines_running = 1`, `shared-cpu-1x` 512 MB, health check `GET /healthz`.
- Secretos: `fly secrets set DATABASE_URL=… SESSION_SECRET=…` (Supabase: pooler en modo sesión, puerto 5432). Luego `fly deploy` y, una vez, `owner:init` y `catalog:sync` contra esa base (`fly ssh console` → `cd /app/apps/api && OWNER_EMAIL=… OWNER_PASSWORD=… node dist/cli/owner-init.js`).

## Estructura

```
prisma/            schema.prisma + migrations
prisma.config.ts   datasource (Prisma 7)
src/config/        env.ts (zod), dotenv.ts, config.module.ts
src/logging/       nestjs-pino (sin cookies ni Authorization en los logs)
src/prisma/        PrismaService (pool pg + adapter)
src/auth/          owner, sesiones, login, TOTP, argon2, cifrado del secreto
src/http/          exposición: middleware de sesión, cabeceras, filtro de errores, /login, /healthz, /.well-known
src/web/           estáticos de la PWA + fallback SPA
src/tokens/        tokens de API y guard bearer
src/worker/, src/mcp/   stubs con guard bearer
src/catalog/       fuentes, repositorio, vistas, servicio en memoria, sync, controlador
src/cli/           owner-init, catalog-sync
test/              e2e (supertest)
```

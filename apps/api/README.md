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
| `DATABASE_URL` | sí | — | `postgresql://…`. Local: `postgresql://tcg:tcg@127.0.0.1:5433/tcg` (usar `127.0.0.1`, no `localhost`: el motor de Prisma resuelve `localhost` por IPv6 y Docker en Windows no responde ahí). Producción: ver «Deploy» (pooler de Supabase con `sslmode=verify-full`). |
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
| `BACKUP_CRON` | no | `true` en producción, `false` si no | Copia diaria de seguridad a las 04:00 **hora de Buenos Aires** (`America/Argentina/Buenos_Aires`; el contenedor corre en UTC) en `backup_blobs`, conservando las últimas 14. |
| `LOG_LEVEL` | no | `info` en producción, `debug` si no | Nivel de pino (`silent` apaga). |
| `APP_VERSION` | no | versión de `package.json` | Lo que informa `/healthz`. |
| `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` | no | `19456`, `2`, `1` | Costo de argon2id para hashes nuevos (mínimo recomendado por OWASP: 19 MiB, 2 pasadas, 1 hilo). Los valores por defecto de la librería (64 MiB × 4 hilos) no entran en la máquina de 512 MB con varios intentos de login a la vez. El costo queda guardado en el hash: cambiarlo solo afecta contraseñas nuevas. |

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

Baja los ocho archivos del tracker (`raw.githubusercontent.com`, commit fijado) y `database.json` de deckgym, calcula sha256 de cada uno, construye el catálogo con `@tcg/domain` (`buildCatalogWithReport`), lo compara con el cargado (`diffCatalog`) y lo escribe entero en una transacción (upsert completo: expansiones, sobres, grupos funcionales, cartas, `pack_cards`, alias de evolución; siembra `rarity_rules` con `ON CONFLICT DO NOTHING`: solo agrega rarezas nuevas, nunca pisa `points`, `points_verified` ni `tradeable`). En esa misma transacción deja la fila de `catalog_syncs` (estado, conteos, hashes, informe, diff) y los cambios por carta en `catalog_sync_changes`, así las tablas y el estado nunca quedan desfasados. Al terminar recarga el índice en memoria. `--from-fixtures` lee `packages/domain/test/fixtures` (offline; es lo que usan los tests). Salida: JSON con el resumen; código 2 si quedó en `needs_review`. Al arrancar, el proceso marca como `failed` cualquier sync que haya quedado en `running` (un reinicio a mitad de camino): solo corre uno a la vez y el candado vive en memoria.

Pendiente (I12): cuando cambian unidades de stock o grupos y ya hay colección/mazos, el sync aplica el catálogo y queda en `needs_review` con un aviso; el remapeo automático de colección, ajustes y mazos no está implementado todavía.

## Rutas y exposición

Sigue `docs/API.md`. Errores siempre como `{ error: { code, message, details? } }` (`validation`, `unauthenticated`, `invalid_credentials`, `totp_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `not_implemented`, `unavailable`, más los códigos propios de cada módulo: `invalid_csv`, `import_blocked`, `import_not_pending`, `adjustment_active`, `adjustment_inactive`, `conversion_*`, `unknown_card`, `built_in_game_limit`, `deck_not_archived`, `energy_required`, `invalid_backup`, `unsupported_schema`…). Los ids numéricos (mazos, ajustes, importaciones, copias) salen como strings. Los booleanos de la query se escriben `true`/`false`. Todo exige la cookie de sesión salvo lo marcado. Las navegaciones sin sesión (GET fuera de `/api`, también chunks y manifest) redirigen 302 a `/login`; las llamadas a `/api/*`, los métodos no-GET y los clientes que piden JSON reciben `401 { error: { code: 'unauthenticated' } }`.

| Ruta | Acceso | Qué hace |
|---|---|---|
| `GET /healthz` | pública | `{ ok, version, catalogCommit, engineRev }` (health check de Fly). Hace `SELECT 1`: `503 unavailable` si la base no responde en 3 s. |
| `GET /login` | pública | Página de ingreso autocontenida (correo, contraseña, código de 6 dígitos). Con sesión redirige a `/`. |
| `POST /api/auth/login` | pública, 5 intentos / 15 min por IP (429 al 6.º; los exitosos también cuentan) | `{ email, password, totp? }` → `204` + cookie de sesión. Si la petición traía una sesión válida, se cierra y se reemplaza. Cada código TOTP vale para un solo ingreso (se guarda el último paso aceptado en `owner.totp_last_step`). |
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
| `GET /api/collection/summary` | sesión | `{ copies, stockUnitsCollected, groupsWithAtLeast: { one, two }, groupsMissing, lastImportAt, activeAdjustments }`. |
| `GET /api/collection/groups?q=&expansion=&missingOnly=&limit=&offset=` | sesión | Vista por carta funcional: `{ items: [{ group, playable, fromStock, hasAdjustment }], total }` (orden del catálogo o relevancia de la búsqueda por id/nombre). |
| `GET /api/collection/stock?q=&expansion=&onlyOwned=&limit=&offset=` | sesión | Vista por edición: `{ items: [{ card, owned, collected, twinCardIds }], total }`. |
| `PATCH /api/collection/stock/:cardId` | sesión | `{ amountOwned?, collected? }` → edición manual sobre la unidad de stock (`affectedTwinIds`) y `activeAdjustment` del grupo si lo hay (regla c). |
| `POST /api/collection/imports` | sesión | multipart `file` (≤ 5 MB) o `{ csv }` → `201 ImportPreview` pendiente (parseo, dedupe por unidad de stock, diff contra el stock actual y reglas a/b de los ajustes). |
| `GET /api/collection/imports`, `GET …/:id` | sesión | Lista e `ImportPreview` (el diff de una pendiente se recalcula al pedirla). |
| `POST /api/collection/imports/:id/apply` \| `discard` | sesión | Aplica (una transacción SQL: upsert de las unidades que cambian, estado `applied`) o descarta; `409` si no está pendiente o está bloqueada. |
| `GET /api/collection/export.csv` | sesión | `tcgcollectiontracterexport.csv` byte-idéntico al formato del tracker (BOM + LF, nombres en español). |
| `GET` \| `POST /api/collection/adjustments`, `POST …/:id/resolve` \| `convert` | sesión | Ajustes de copias jugables por carta funcional (uno activo por grupo; conversión = edición manual + resolución `converted`). |
| `GET` \| `POST /api/decks`, `GET` \| `PATCH` \| `DELETE /api/decks/:id` | sesión | Mazos con validación (`validateDeck`), completitud contra toda la colección, revisiones (nueva solo si cambian cartas o energías), registro de cambios, `builtInGame` ≤ 25 (`409 built_in_game_limit`), archivado (solo se borran archivados). |
| `POST /api/decks/:id/duplicate`, `POST /api/decks/:id/revisions/:n/restore` | sesión | Copia como variante; vuelve a una revisión anterior con una revisión `restore`. |
| `GET /api/decks/:id/export?format=spanish\|deckgym\|limitless\|json` | sesión | Texto del mazo (deckgym siempre con `Energy:`). |
| `POST /api/decks/validate`, `POST /api/decks/import`, `POST /api/decks/import/commit`, `GET /api/decks/by-card/:groupId` | sesión | Validar sin guardar; vista previa de texto (`auto`, `spanish`, `spanish-file`, `limitless`, `json`); crear varios de una vez; qué mazos usan un grupo. |
| `GET /api/backup/export`, `POST /api/backup/import?mode=dry-run\|replace`, `GET /api/backup/blobs`, `GET …/:id` | sesión | Copia de seguridad gzip JSON (`schemaVersion: 1`) de colección, mazos, ajustes, configuración y metadatos de tokens; restauración en una transacción; copias diarias guardadas. |
| `GET /api/settings`, `PUT /api/settings/:key` | sesión | Configuración por clave conocida (`ui`, `alpha`, `minPlayers`…), valor JSON libre. |
| `/api/worker/*` | bearer `tcg_wk_*` con `worker:claim` | Stub: `GET /api/worker/ping`. |
| `/api/mcp` | bearer `tcg_mcp_*` con `mcp:read` | Stub: 501 hasta la Fase 3. |
| `/.well-known/*` | pública | 404 por ahora (reservado para OAuth si hiciera falta). |
| resto (`/`, `/assets/*`, `/sw.js`, `/manifest.webmanifest`…) | sesión | Estáticos de `WEB_DIST` (`/assets/*` inmutable; shell, sw y manifest `no-store`) y fallback a `index.html`. |

Subidas de archivos: multipart con `multer` en memoria (`FileInterceptor`), CSV hasta 5 MB y backups hasta 50 MB (`413` si se pasan); un backup gzip se descomprime con tope de 128 MB (`400 invalid_backup` si lo supera: protege de una «bomba» gzip).

Sesiones: id aleatorio de 32 bytes en la cookie, SHA-256 en `sessions`; 30 días deslizantes (se extienden cuando pasó más de un día desde `last_seen_at`); `HttpOnly; SameSite=Lax; Path=/` (+ `Secure`). Las sesiones se memorizan 30 s en el proceso (DECISIONES 1.11): el logout y el cambio de contraseña invalidan al instante, pero `owner:init` (otro proceso) cierra las sesiones en la base y el servidor en marcha puede seguir aceptando una ya cargada hasta 30 s. Escrituras de otro sitio (`Sec-Fetch-Site: cross-site` u `Origin` ajeno en una petición que no sea GET/HEAD/OPTIONS) reciben `403 forbidden` antes de mirar la cookie; las rutas con token quedan fuera. Cabeceras de seguridad en todas las respuestas (CSP, `nosniff`, `frame-ancestors 'none'`, HSTS con `COOKIE_SECURE`). Cuerpos JSON hasta 10 MB.

## Tokens de API

`POST /api/tokens` con `{ name, kind: 'worker' | 'mcp', scopes }` devuelve el token en claro **una sola vez** (`tcg_wk_…` / `tcg_mcp_…` = prefijo + 32 bytes aleatorios en base64url); en la base queda solo el SHA-256, el prefijo para mostrar, `last_used_at` y `revoked_at`. Scopes: `worker:claim` (worker), `mcp:read`, `mcp:write` (MCP). `DELETE /api/tokens/:id` revoca. El guard (`src/tokens/bearer-token.guard.ts`) responde 401 sin token válido y 403 sin el scope.

## Tests

```bash
pnpm -F @tcg/api test        # unitarios (vitest): env, cookies, cifrado, tokens, reglas de exposición, envoltorio de errores, página de login, ids, detección de formato de mazos
pnpm -F @tcg/api test:e2e    # supertest contra TEST_DATABASE_URL
```

Los e2e (`test/*.e2e-spec.ts`, `vitest.config.e2e.ts`) crean la base de prueba si no existe, aplican `prisma migrate deploy` y truncan todas las tablas (`test/global-setup.ts`); corren de a un archivo, también en CI (job `e2e` de `.github/workflows/ci.yml` con un servicio `postgres:17`). Cubren exposición y cabeceras (incluido el rechazo de escrituras cross-site), login/TOTP (y su repetición)/throttle/logout/reemplazo de sesión al ingresar/expiración deslizante/cambio de contraseña, tokens y guard bearer, el catálogo (sync desde fixtures: 4.317 cartas, «Copiona» y «Copycat» dan el mismo grupo `B1-225`, `A4b-1` comparte unidad de stock con `A1-1`, detalle de grupo con stock/ajuste/mazos, re-sync por HTTP con diff vacío, re-sync sin pisar `rarity_rules`, cierre de un sync `running` huérfano) y la aceptación de PLAN §7 con los datos reales de `docs/context/`:

- `collection.e2e-spec.ts`: importa el CSV del 6/10/2026 por multipart (4.317 filas, 5.844 ingenuo vs 4.714 deduplicado), lo aplica y verifica las copias jugables (Mega-Mawile ex 2, Globito 3, Bulbasaur A1-1 3, Latias 2, Latios 2, Hoopa ex 1, Espeon ex 2, Mega Sharpedo ex 1, Riolu A2-91 1, Riolu B3-79 9), el resumen (1.255 grupos con ≥ 2, 1.853 con ≥ 1, 466 sin copias, 2.083 unidades coleccionadas), la exportación byte-idéntica al archivo original, la reimportación con diff vacío, las cuatro reglas de los ajustes (Latias = 2 «ya coincide», Latias = 1 oculta el cambio 3 → 2, edición manual con ajuste activo, conversión) y el bloqueo de un archivo con gemelas inconsistentes.
- `decks.e2e-spec.ts`: vista previa de `mazos_40_listas.md` (40 borradores, 0 errores, el 10 pide elegir energía), alta de los 40 (todos válidos y completos), exportación deckgym del 9 con `Energy: Fire, Lightning`, límite de 25 armados (también al desarchivar un mazo que sigue marcado), mazo de 19 cartas («Tiene 19 cartas, falta 1»), revisiones/restauración/duplicado/archivado/borrado y «qué mazos usan X».
- `backup.e2e-spec.ts`: configuración por clave, export → import `replace` sobre la base vaciada → export idéntico salvo `exportedAt`, dry-run, rechazo de una bomba gzip, rechazo de ids desconocidos y retención de 14 copias diarias.

La sincronización del catálogo desde fixtures tarda ~2 s, así que cada archivo la hace una vez en `beforeAll`; la suite completa corre en ~25 s.

## Deploy (Fly.io)

- `Dockerfile` (raíz): multi-stage con pnpm. La etapa `deps` copia `apps/api/prisma/schema.prisma` y `prisma.config.ts` antes de `pnpm install` (el `postinstall` de la API corre `prisma generate`); `build` compila `@tcg/domain`, genera el cliente de Prisma, compila la PWA y la API y vuelve a instalar solo las dependencias de producción de `@tcg/api` y `@tcg/domain` (`pnpm install --prod --filter "@tcg/api..."` desde el store local: ~330 MB de `node_modules`, la mayor parte el CLI de Prisma, DECISIONES 1.13); la imagen final es `node:24-alpine` con `WEB_DIST=/app/apps/web/dist`. `docker/entrypoint.sh` corre `prisma migrate deploy` (schema engine `linux-musl`) y arranca `node dist/main.js`.
- Probar la imagen en local contra el Postgres de Docker Compose (Docker Desktop en Windows: `host.docker.internal`; en Linux, `--network host` y `127.0.0.1`):

  ```bash
  docker build -t tcg-pocket:local .
  docker run --rm -p 3200:3200 -e DATABASE_URL=postgresql://tcg:tcg@host.docker.internal:5433/tcg_test \
    -e SESSION_SECRET=<48 caracteres aleatorios> -e NODE_ENV=production -e PORT=3200 tcg-pocket:local
  curl -i localhost:3200/healthz      # 200 { ok: true, … } (503 si la base no responde)
  curl -s localhost:3200/login | head # la página de ingreso
  ```

- `fly.toml`: app `tcg-pocket`, región `gru`, puerto interno 3000, `force_https`, `auto_stop_machines = false`, `min_machines_running = 1`, `shared-cpu-1x` 512 MB, health check `GET /healthz` cada 30 s con `grace_period = "60s"` (cubre `migrate deploy` más la carga del catálogo en un arranque frío).
- `DATABASE_URL` en producción (Supabase, plan Free): usar el **pooler en modo sesión**, puerto **5432** (`postgresql://postgres.<ref>:<clave>@aws-0-<región>.pooler.supabase.com:5432/postgres?sslmode=verify-full`). Motivos: la conexión directa `db.<ref>.supabase.co` es solo IPv6 y el pooler da IPv4; el puerto 6543 (modo transacción) rompe `pool.connect()` + `BEGIN` y las sentencias preparadas que usa la app. SSL: `pg` 8.16 (`pg-connection-string` 2.14) trata `sslmode=verify-full` como verificación completa contra las CA del sistema (`require`/`prefer` también, pero avisan que cambiarán de semántica); el certificado del pooler es de una CA pública, así que no hace falta `sslrootcert`. Si al conectar fallara la verificación, bajar el certificado raíz de Supabase (`prod-ca-2021.crt`) y agregar `&sslrootcert=/ruta`, o como último recurso `uselibpqcompat=true&sslmode=require` (cifra sin verificar). `prisma migrate deploy` (arranque del contenedor) acepta `disable|prefer|require` y trata otros valores como `prefer`, con lo que negocia TLS igual. El pool de la app es de 8 conexiones (cabe en el pooler Free). **Pendiente de verificar una vez contra el pooler real** antes del primer `fly deploy`.
- Secretos: `fly secrets set DATABASE_URL=… SESSION_SECRET=…`. Luego `fly deploy` y, una vez, `owner:init` y `catalog:sync` contra esa base (`fly ssh console` → `cd /app/apps/api && OWNER_EMAIL=… OWNER_PASSWORD=… node dist/cli/owner-init.js`).

## Estructura

```
prisma/            schema.prisma + migrations
prisma.config.ts   datasource (Prisma 7)
src/config/        env.ts (zod), dotenv.ts, config.module.ts
src/logging/       nestjs-pino (sin cookies ni Authorization en los logs)
src/prisma/        PrismaService (pool pg + adapter) + helpers SQL por lotes (upsertMany)
src/auth/          owner, sesiones, login, TOTP, argon2, cifrado del secreto
src/http/          exposición: middleware de sesión, cabeceras, filtro de errores, /login, /healthz, /.well-known
src/web/           estáticos de la PWA + fallback SPA
src/tokens/        tokens de API y guard bearer
src/worker/, src/mcp/   stubs con guard bearer
src/catalog/       fuentes, repositorio, vistas, servicio en memoria, sync, controlador, uso en mazos
src/collection/    repositorio (stock + ajustes como objetos del dominio), servicio (vistas, edición manual, importaciones, export CSV, ajustes), controlador
src/decks/         formatos de texto (detección), servicio (revisiones, cambios, validación, completitud, exportadores), controlador
src/backup/        esquema zod del documento, servicio (export/import/blobs), cron diario, controlador
src/settings/      configuración por clave
src/cli/           owner-init, catalog-sync
test/              e2e (supertest)
```

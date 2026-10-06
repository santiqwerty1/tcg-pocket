# CLAUDE.md

App personal de Pokémon TCG Pocket para un solo usuario (Santi). El brief completo está en `docs/BRIEF.md`; léelo antes de cualquier tarea. Este archivo resume estado, convenciones y comandos.

## Estado

- **Fase 0 entregada y aprobada el 6/10/2026**: `docs/PLAN.md` (revisión 2 + Apéndice E de herramientas), `docs/DECISIONES.md` (bloque A aprobado: Fly siempre encendida ≈ 4 US$, Supabase Free, login contraseña+TOTP a mano, modelo de datos, `engine-cli`, Descope como servidor OAuth si hace falta, repo privado en GitHub), `docs/LICENCIAS.md`, `docs/fase0/`. No hay código de la app todavía.
- Conector remoto de Claude: la cuenta de Santi admite «Encabezados de solicitud» → token fijo `tcg_mcp_*`, sin OAuth (capturas del 6/10/2026). Dominio: `*.fly.dev`.
- **Fase 1 en curso desde el 6/10/2026** (aprobada por Santi).
- Siguiente paso: Fase 1 (M1 catálogo, M2 colección, M3 mazos, backup, login, deploy) según PLAN §7, con el bloque B del plan en sus valores por defecto.

## Cómo trabajar acá

- Trabajo por fases; al terminar cada una: qué quedó, cómo lo prueba Santi, qué decidí. Esperar el visto bueno antes de seguir.
- Preguntar antes de las decisiones caras de revertir (stack, modelo de datos, hosting, autenticación). El resto se decide y se anota en `docs/DECISIONES.md` con una línea de motivo.
- Verificar con los datos reales de `docs/context/` (CSV de la colección, `mazos_40_listas.md`), no solo con ejemplos inventados.
- Tests para toda la lógica de dominio: conteo de copias, validación de mazos, probabilidades de sobres, estadísticas, importadores y exportadores.
- Antes de reimplementar algo, mirar si existe en `refs/tracker` o `refs/deckgym-core` y leer su código.
- Código, identificadores y commits en inglés; interfaz y textos en español, con los nombres de cartas en español. Un solo usuario: no diseñar como SaaS.
- Mantener `docs/LICENCIAS.md` cuando se tome algo de los repositorios de referencia; no copiar código de UI del tracker (GPL); no modificar deckgym-core; no copiar imágenes de cartas.

## Archivos y datos

- La carpeta de documentación es `docs/` (renombrada al crear el repo, DECISIONES 0.2).
- `docs/BRIEF.md`: el brief. `docs/PLAN.md`: plan de Fase 0 (revisión 2). `docs/DECISIONES.md`, `docs/LICENCIAS.md`.
- `docs/context/guia_del_proyecto.md`: reglas del dominio y método. `docs/context/mazos_40_listas.md`: los 40 mazos (sin energía por mazo: está en la columna «Energía» de la tabla resumen). `docs/context/tcgcollectiontracterexport-2026-10-06.csv`: exportación de la colección del 6/10/2026 (4.317 filas, sha256 `f774c6e4…17e8`); se renombra con fecha al crear el repo (DECISIONES 0.3).
- `docs/fase0/`: informes de investigación, respuestas crudas de Limitless (`limitless/`), fixtures de sobres y lista de cartas no implementadas en el motor. Usarlos como fixtures de tests en vez de volver a consultar la API.
- `refs/tracker` = `marcelpanse/tcg-pocket-collection-tracker` @ `3ab58f1` (GPL-3.0). `refs/deckgym-core` = `bcollazo/deckgym-core` @ `fb792ebf` (AGPL-3.0). Clones shallow, solo lectura, no se versionan.
- Datos clave verificados: 4.317 cartas, 3.866 `internal_id` distintos, 2.319 grupos funcionales; los 40 mazos validan y están completos contra el CSV del 6/10; copias jugables Mega-Mawile ex 2, Globito 3, Bulbasaur A1-1 3. Fixtures en `docs/PLAN.md` Apéndice B.

## Entorno y comandos

- Windows 11, PowerShell. Disponibles: node 24, pnpm (instalar si falta), git, gh (autenticado), curl. **No** hay cargo/rustc (el motor se compila en GitHub Actions según el plan).
- La API de Limitless limita a 50 requests por 5 minutos por IP: no la llamar en bucle desde scripts ad hoc.
- Postgres local: `docker compose up -d` (Postgres 17 en `127.0.0.1:5433`, usuario/clave/db `tcg`; base de tests `tcg_test`). `.env` se copia de `.env.example` y **no se versiona**; usar `127.0.0.1` y no `localhost` en `DATABASE_URL` (el motor de Prisma resuelve `localhost` por IPv6 y Docker en Windows no responde ahí) y un `SESSION_SECRET` de ≥ 32 caracteres.
- Orden de build: `pnpm -F @tcg/domain build` antes de typecheck/tests/build de `@tcg/api` (resuelve `@tcg/domain` por `dist/`). Tras `pnpm install`: `pnpm -F @tcg/api db:generate`.
- Base de datos (`apps/api`, Prisma 7, `prisma.config.ts`): `pnpm -F @tcg/api db:migrate` (dev, crea/aplica migraciones), `db:deploy` (producción), `db:generate`, `db:reset` (borra todo; solo dev).
- Usuario y catálogo: `OWNER_EMAIL=… OWNER_PASSWORD=… pnpm -F @tcg/api owner:init [--no-totp]` (imprime el secreto TOTP una vez) y `pnpm -F @tcg/api catalog:sync [--commit sha] [--engine-rev sha] [--from-fixtures]` (`--from-fixtures` usa `packages/domain/test/fixtures`, sin red). Ambos compilan antes (`nest build`).
- Calidad: `pnpm lint` / `pnpm lint:fix` (biome), `pnpm -F @tcg/api typecheck | test | test:e2e | build`; `test:e2e` usa `TEST_DATABASE_URL` (crea la base, aplica migraciones y trunca tablas). Servidor: `pnpm -F @tcg/api start` (`dist/main.js`) o `start:dev`; login en `http://localhost:3000/login`.
- Deploy: `Dockerfile` y `fly.toml` en la raíz (app `tcg-pocket`, región `gru`, `/healthz`); secretos `DATABASE_URL` y `SESSION_SECRET` con `fly secrets set`; `fly deploy`. El contenedor corre `prisma migrate deploy` al arrancar. Detalle en `apps/api/README.md`.
- Pendiente de Fase 1: `pnpm worker:install-task` (worker de Windows, Fase 6).

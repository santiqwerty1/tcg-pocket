---
tipo: documento
titulo: >-
  Producción
area: operacion
estado: vigente
actualizado: '2026-10-07'
origen:
  - CLAUDE.md
  - apps/api/README.md
revisar: false
---

# Producción

- App: `https://tcg-pocket.fly.dev` (Fly.io, app `tcg-pocket`, región `gru`, una máquina shared-cpu-1x 512 MB). Postgres en Supabase (São Paulo, pooler de sesión, `sslmode=verify-full` con la CA de `apps/api/certs/`).
- Deploy: `flyctl deploy --app tcg-pocket --remote-only --ha=false` (siempre `--ha=false`: Fly crea dos máquinas por defecto). El contenedor corre `prisma migrate deploy` al arrancar.
- Secretos: `DATABASE_URL` y `SESSION_SECRET` con `flyctl secrets set`; `DATABASE_URL` local en `.env.fly`, que nunca se versiona ni se muestra.
- Tareas puntuales: `flyctl machine exec <id> --app tcg-pocket "<comando>"` (la consola SSH no anda desde esta PC, [R-005](../Seguimiento/Riesgos/R-005.md)). Tras un `catalog-sync` por CLI hay que reiniciar la máquina o usar `POST /api/catalog/sync`: el catálogo vive en memoria.
- Backup diario a las 04:00 de Buenos Aires en `backup_blobs`; exportación manual en Más → Backup.

Detalle y comandos completos en [CLAUDE.md](../../CLAUDE.md) y `apps/api/README.md`.

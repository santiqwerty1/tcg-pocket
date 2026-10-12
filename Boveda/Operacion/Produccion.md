---
tipo: documento
titulo: >-
  Producción
area: operacion
estado: vigente
actualizado: '2026-10-11'
origen:
  - CLAUDE.md
  - apps/api/README.md
  - docs/OPERACION.md
revisar: false
---

# Producción

- **App:** `https://tcg-pocket.fly.dev` (Fly.io, app `tcg-pocket`, región `gru`, una máquina shared-cpu-1x 512 MB). Postgres en Supabase (São Paulo, pooler de sesión, `sslmode=verify-full` con la CA de `apps/api/certs/`).
- **Qué corre al 11/10/2026:** el contenido de `abd5034` del repo público, que es `9f934fc` del viejo. No se redesplegó después de la mudanza.
- **Deploy:** `pnpm deploy:fly`. Exige el commit en `origin/main` con la CI verde y `posta check`, y corre `flyctl deploy --app tcg-pocket --remote-only --ha=false`; siempre `--ha=false`, porque Fly crea dos máquinas por defecto. Las migraciones van en `release_command`, y el contenedor las vuelve a correr al arrancar.
- **Secretos:** `DATABASE_URL` y `SESSION_SECRET` con `flyctl secrets set`; `DATABASE_URL` local en `.env.fly`, que nunca se versiona ni se muestra. `TRACKER_COLLECTION_ANON_KEY` cargado el 11/10 ([T-020](../Seguimiento/Tareas/T-020.md)). Pendientes: los de Tigris ([P-010](../Seguimiento/Preguntas/P-010.md)).
- **Tareas puntuales:** `flyctl machine exec <id> --app tcg-pocket "<comando>"`; la consola SSH no anda desde esta PC ([R-005](../Seguimiento/Riesgos/R-005.md)). Tras un `catalog-sync` por CLI hay que reiniciar la máquina o usar `POST /api/catalog/sync`, porque el catálogo vive en memoria.
- **Backup:** diario a las 04:00 de Buenos Aires en `backup_blobs`; exportación manual en Más → Backup.
- **Repo:** `santiqwerty1/tcg-pocket`, público desde el 11/10/2026 ([D-022](../Seguimiento/Decisiones/D-022.md)). El privado viejo, `santiqwerty1/tcg-pocket-historial`, está archivado. La CI corre en los runners de GitHub, y los runners propios no se usan en el repo público ([D-023](../Seguimiento/Decisiones/D-023.md)).
- **Workers:** el paquete portable de Windows y el de Android se actualizan solos desde la app ([D-026](../Seguimiento/Decisiones/D-026.md)). Un deploy que cambia el worker o el motor ya no pide recompilar ni reiniciar nada en la PC.

Detalle y comandos completos en [CLAUDE.md](../../CLAUDE.md), `docs/OPERACION.md` y `apps/api/README.md`.

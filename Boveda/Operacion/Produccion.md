---
tipo: documento
titulo: >-
  Producción
area: operacion
estado: vigente
actualizado: '2026-10-29'
origen:
  - CLAUDE.md
  - apps/api/README.md
  - docs/OPERACION.md
revisar: false
---

# Producción

- **App:** `https://tcg-pocket.fly.dev` (Fly.io, app `tcg-pocket`, región `gru`, una máquina shared-cpu-1x 512 MB). Postgres en Supabase (São Paulo, pooler de sesión, `sslmode=verify-full` con la CA de `apps/api/certs/`). Desde #116 (18/10), producción exige `verify-full` en la app y en las migraciones, que también verifican el certificado ([H-058](../Seguimiento/Hallazgos/H-058.md)).
- **Qué corre al 29/10/2026:** desplegada hasta `4cd4bfb` (#160), con C1 en el catálogo y en el motor. Versión 1.0.0 (tag `v1.0.0` en `2fd579e`, [P-013](../Seguimiento/Preguntas/P-013.md)), engine-cli 0.3.17 y worker 0.3.15. El motor es la copia de deckgym en `77e0617`, sobre upstream `7aa4ef0` (#160, [D-031](../Seguimiento/Decisiones/D-031.md)), y el catálogo, el tracker en `9fafc07`.
- **La máquina:** una sola. Su id cambia cuando un deploy la reemplaza, como pasó el 19/10, así que se busca cada vez con `flyctl machine list --app tcg-pocket` y no se escribe en el repo.
- **Deploy:** `pnpm deploy:fly`. Exige el commit en `origin/main` con la CI verde y `posta check`, y corre `flyctl deploy --app tcg-pocket --remote-only --ha=false`; siempre `--ha=false`, porque Fly crea dos máquinas por defecto. Las migraciones van en `release_command`, y el contenedor las vuelve a correr al arrancar.
- **Secretos:** `DATABASE_URL` y `SESSION_SECRET` con `flyctl secrets set`; `DATABASE_URL` local en `.env.fly`, que nunca se versiona ni se muestra. `TRACKER_COLLECTION_ANON_KEY` cargado el 11/10 ([T-020](../Seguimiento/Tareas/T-020.md)). Los del bucket de Tigris, cargados el 12/10 ([P-010](../Seguimiento/Preguntas/P-010.md)).
- **Tareas puntuales:** `flyctl machine exec <id> --app tcg-pocket "<comando>"`; la consola SSH no anda desde esta PC ([R-005](../Seguimiento/Riesgos/R-005.md)). Desde #75 los CLI se pueden correr con la API viva: no corren crons ni hooks de arranque (DECISIONES 45.51). Después de un `catalog-sync` por CLI, la API recarga el catálogo sola en menos de un minuto (#103); hasta entonces `/healthz` muestra el anterior. Desde #135, el CLI dice en stderr, antes de escribir, qué commit y qué `engineRev` va a usar.
- **Backup:** diario a las 04:00 de Buenos Aires en `backup_blobs` y, desde el 12/10, su subida al bucket `tcg-pocket-backups` de Tigris (falta registrar la primera buena); exportación manual en Más → Backup.
- **Limpieza:** automática desde el 12/10 (`RETENTION_CRON=true`, 04:20). La primera, aplicada a mano con el OK de Santiago, liberó 39,1 MB ([R-006](../Seguimiento/Riesgos/R-006.md), DECISIONES 42.7).
- **Repo:** `santiqwerty1/tcg-pocket`, público desde el 11/10/2026 ([D-022](../Seguimiento/Decisiones/D-022.md)). El privado viejo, `santiqwerty1/tcg-pocket-historial`, está archivado. La CI corre en los runners de GitHub, y los runners propios no se usan en el repo público ([D-023](../Seguimiento/Decisiones/D-023.md)).
- **Workers:** el paquete portable de Windows y el de Android se actualizan solos desde la app ([D-026](../Seguimiento/Decisiones/D-026.md)). Un deploy que cambia el worker o el motor ya no pide recompilar ni reiniciar nada en la PC.

Detalle y comandos completos en [CLAUDE.md](../../CLAUDE.md), `docs/OPERACION.md` y `apps/api/README.md`.

# Operación

Cómo se sabe si la app anda, qué corre sola y qué hacer cuando algo falla (Fase 38, R-011, R-008).

## Qué corre sola

| Tarea | Cuándo | Si falla |
|---|---|---|
| Copia diaria (`backup_blobs`) | 04:00 de Buenos Aires (`BACKUP_CRON`, en producción) | Aviso `backup_stale`: «Falló la copia diaria del …» o «No hay copia diaria desde …» (más de 26 h) |
| Copia fuera de Supabase (bucket de Tigris, Fase 39) | Después de la copia diaria; a mano con `POST /api/backup/offsite` | Aviso `backup_offsite`: la subida falló o no hubo una buena en 26 h |
| Limpieza (repeticiones viejas, crudos de standings, Fase 39) | 04:20, solo con `RETENTION_CRON=true`; vista previa con `node /app/apps/api/dist/cli/retention.js` o `POST /api/ops/retention` (`--apply`/`?apply=1` borra) | En el log; el resultado en `/api/ops/status` (`retention`) |
| Comprobación de la copia en la nube (Fase 39) | El 1 de cada mes, con la prueba de restauración | Aviso `backup_offsite`: «Falló la comprobación de la copia en la nube» |
| Prueba de restauración | El 1 de cada mes a las 04:30 | Aviso `backup_drill` |
| Sincronización de Limitless | Al arrancar y cada 6 h (`LIMITLESS_SYNC`, en producción) | Aviso `limitless_sync`: la última corrida falló, o ninguna buena en 13 h |
| Actualización del catálogo | A mano (Más → Catálogo) | Aviso `catalog_sync` si la última falló (sigue el catálogo anterior) |
| Chequeos de GitHub (set nuevo del tracker, commits nuevos de deckgym) | Cada 12 h (cada hora después de una falla) | Aviso `github_check` (info) |
| Workers | Cuando hay trabajo | Aviso `worker_idle`: hay trabajo y ningún worker en 30 min |
| Tamaño de la base | — | Aviso `database_size` desde 350 MB (el plan gratis de Supabase llega a 500) |

Los avisos se ven en Más → Avisos y llegan al celu como notificación (`NotificationsWatcher`, cada 15 s), una vez por título. Cada título lleva la fecha, así que una falla nueva vuelve a avisar.

## Estado del servidor

`GET /api/ops/status` (con sesión) y la tool `system_status` (Claude) devuelven lo mismo:
- la versión desplegada (el sha del commit);
- la memoria (`rss`, el heap y su techo);
- el tamaño de la base;
- la última copia;
- la última corrida de Limitless;
- el catálogo;
- los chequeos de GitHub;
- los workers en línea;
- la cola.

## Chequeo externo: UptimeRobot (P-011)

Los avisos los manda el mismo servidor: si se cae, o si Supabase se pausa, no avisa nadie. UptimeRobot mira la app desde afuera.

1. Crear una cuenta gratis en <https://uptimerobot.com>.
2. **Add New Monitor**:
   - **Monitor Type:** Keyword (HTTP(s) – Keyword).
   - **Friendly Name:** TCG Pocket.
   - **URL:** `https://tcg-pocket.fly.dev/healthz`.
   - **Keyword:** `"ok":true`, con **Alert When: Keyword Not Exists**.
     - `/healthz` responde `{"ok":true,…}` solo si el servidor anda y la base contesta en 3 s; si no, da 503 sin esa palabra.
   - **Monitoring Interval:** 5 minutos, el mínimo del plan gratis.
3. **Alert Contacts:**
   - el mail de la cuenta viene incluido;
   - para el celu, instalar la app de UptimeRobot e iniciar sesión: los avisos llegan como notificación.
4. Opcional: una **Status Page** pública, si querés ver el historial sin entrar a la cuenta.

Con esto, una caída se avisa dentro de los 5 minutos, y la vuelta también.

## Copia fuera de Supabase y reconstrucción

La guía para levantar todo desde cero (base nueva, app nueva, restaurar la copia del bucket) está en `docs/RECONSTRUIR.md`.

## Secretos opcionales

- `GITHUB_TOKEN`: los chequeos de GitHub salen sin token desde las IP compartidas de Fly, con un límite de 60 pedidos por hora por IP. Con un token, el límite es de 5.000 por hora.
  - Alcanza un token *fine-grained* con «Public repositories (read-only)» y ningún permiso más.
  - Se carga con `flyctl secrets set GITHUB_TOKEN=… --app tcg-pocket`, sin pasar por el chat.

## Memoria (R-008)

- **La máquina:** 512 MB, con 512 MB de swap (`swap_size_mb` en `fly.toml`), así que un pico la pone lenta en vez de matar el proceso.
- **El heap de V8:** tiene un techo de 320 MB (`NODE_OPTIONS=--max-old-space-size=320`).
- **Los datasets de torneos:**
  - se arman de a uno: dos pedidos de la misma era comparten el armado;
  - después de cada armado, el log deja la memoria (`tournament dataset built`, con `rssMb` y `heapUsedMb`);
  - vencen una vez por corrida de Limitless, no después de cada torneo.
- **Las situaciones para resolver:** guardan en memoria las de 64 partidas como máximo (la lista lee 60).

Para mirar la memoria sin entrar a la app: `system_status`, o `GET /api/ops/status` con sesión.

## CI en la PC (D-023)

Mientras el repo sea privado y sin minutos de Actions, la CI corre en dos runners propios de la PC: `tcg-pc-1` y `tcg-pc-2`, con la etiqueta `tcg-pc`.
- **Dónde están:** en `%USERPROFILE%\actions-runner`.
- **Arranque:** al iniciar sesión, por `tcg-pocket-ci-runners.vbs` en Inicio.
- **Instalar:** `powershell -ExecutionPolicy Bypass -File scripts\ci-runner\install.ps1`.
- **Otra PC** (por ejemplo la del Ryzen): clonar el repo y correr el mismo script con otro prefijo, `install.ps1 -Prefix tcg-ryzen`. Con el mismo nombre, `config.cmd --replace` se llevaría los runners de la primera PC. El script revisa antes Git, gh con sesión, Docker Desktop, Rust (GNU) y WinLibs, y dice con qué `winget` instalar lo que falte. La etiqueta sigue siendo `tcg-pc`, así que la CI usa los runners de las dos PC. Si esa PC también corre el worker, conviene bajarle núcleos para que los tests no venzan por tiempo.
- **Cómo elige runner la CI:** con las variables del repo `CI_RUNNER` y `CI_RUNNER_WINDOWS` (`tcg-pc`). Sin ellas, vuelve a los de GitHub.
- **Base y puerto por runner:** `tcg_ci_test_<runner>` y `tcg_ci_screens_<runner>`, en el Postgres de `docker compose`, y un puerto propio para las pantallas. No pisan los de las sesiones.
- **El motor:** se compila con el Rust y el WinLibs de la PC, en `%USERPROFILE%\actions-runner\tcg-pc-<n>\_work\tcg-pocket\cargo-target`.
- **Ver si andan:** `gh api repos/santiqwerty1/tcg-pocket/actions/runners` (`online`).
  - Si están caídos: `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "wscript.exe `"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\tcg-pocket-ci-runners.vbs`"" }`.
  - Nunca `Start-Process` desde una sesión de Claude (H-016).
- **Seguridad:** solo corren código de este repo privado. Los PR de Dependabot no corren en la PC, y Dependabot queda en pausa hasta la mudanza.
- **Sacarlos (antes de pasar el repo a público):**
  1. `powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1`.
  2. `gh variable delete CI_RUNNER` y `gh variable delete CI_RUNNER_WINDOWS`.
  3. `open-pull-requests-limit` de Dependabot a 2 y 1.

## Deploy

`pnpm deploy:fly` (`scripts/deploy.mjs`) hace todo esto:
1. Revisa que el árbol esté limpio, que el commit esté en `origin/main`, que su CI esté en verde y que pase `posta check`.
2. Corre `flyctl deploy --ha=false` con `APP_VERSION` igual al sha.
3. Las migraciones corren en una máquina aparte, antes de reemplazar la que anda (`release_command`): si fallan, el deploy se corta y la app sigue como estaba. Al arrancar el contenedor se corren otra vez, y para entonces no hacen nada.
4. Espera hasta 3 minutos a que `/healthz` responda con la versión nueva. Si no responde, falla.

**Las migraciones tienen que ser compatibles hacia atrás.** Con `release_command`, la versión anterior sigue andando unos minutos con el esquema nuevo, mientras arranca la nueva. Por eso:
- columnas nuevas con valor por defecto o que acepten nulos;
- nada de borrar ni renombrar en el mismo deploy que el código que deja de usarlo: primero el código y después, en otro deploy, la migración que borra.

### Una migración que falló

- **Si falla en el `release_command`:** el deploy se corta y la versión anterior sigue andando. Prisma deja la migración marcada como fallida en `_prisma_migrations`.
- **El contenedor no se cae por eso:** si `migrate deploy` falla al arrancar (P3009), lo deja en el log y arranca igual.
- **Para destrabarla:**
  1. Arreglar la migración en un commit nuevo.
  2. Marcarla como deshecha: `flyctl machine exec <id> --app tcg-pocket "sh -c 'cd /app/apps/api && node node_modules/prisma/build/index.js migrate resolve --rolled-back <nombre_de_la_migración>'"`.
     - Si en realidad se aplicó a mano, va `--applied` en vez de `--rolled-back`.
  3. Desplegar de nuevo.

La CI saltea el motor de Windows cuando no cambió y arma la imagen de Docker solo en main (DECISIONES 41.1–41.3). Dependabot abre como mucho un PR agrupado por mes para npm y otro para las Actions; el motor queda afuera porque deckgym está fijo (D-013).

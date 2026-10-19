# Operación

Cómo se sabe si la app anda, qué corre sola y qué hacer cuando algo falla (Fase 38, R-011, R-008).

## Qué corre sola

| Tarea | Cuándo | Si falla |
|---|---|---|
| Copia diaria (`backup_blobs`) | 04:00 de Buenos Aires (`BACKUP_CRON`, en producción) | Aviso `backup_stale`: «Falló la copia diaria del …» o «No hay copia diaria desde …» (más de 26 h) |
| Copia fuera de Supabase (bucket de Tigris, Fase 39) | Después de la copia diaria; a mano con `POST /api/backup/offsite` | Aviso `backup_offsite`: la subida falló o no hubo una buena en 26 h |
| Limpieza (repeticiones viejas, crudos de standings, Fase 39) | 04:20, solo con `RETENTION_CRON=true` (prendida en producción desde el 12/10/2026); vista previa con `node /app/apps/api/dist/cli/retention.js` o `POST /api/ops/retention` (`--apply`/`?apply=1` borra) | En el log; el resultado en `/api/ops/status` (`retention`) |
| Comprobación de la copia en la nube (Fase 39) | El 1 de cada mes, con la prueba de restauración | Aviso `backup_offsite`: «Falló la comprobación de la copia en la nube» |
| Prueba de restauración | El 1 de cada mes a las 04:30 | Aviso `backup_drill` |
| Sincronización de Limitless | Al arrancar y cada 6 h (`LIMITLESS_SYNC`, en producción) | Aviso `limitless_sync`: la última corrida falló, o ninguna buena en 13 h |
| Actualización del catálogo | A mano (Más → Catálogo) | Aviso `catalog_sync` si la última falló (sigue el catálogo anterior); `catalog_memory` si la memoria no tiene la última aplicada (se carga sola en un minuto) |
| Colección del tracker | Cada 6 h si se habilita en Más → Ajustes; apagada por defecto | Aviso `tracker_sync`; deja revisión ante bajas grandes, cambios manuales recientes o dudas sobre el catálogo |
| Chequeos de GitHub (set nuevo del tracker, commits nuevos de deckgym) | Cada 12 h (cada hora después de una falla) | Aviso `github_check` (info) |
| Workers | Cuando hay trabajo | Aviso `worker_idle`: hay trabajo y ningún worker en 30 min, o ninguno con la feature o la revisión que pide; `worker_paused`: todos los workers vivos están en pausa por resultados perdidos (vuelven solos, sin reiniciar) |
| Tamaño de la base | — | Aviso `database_size` desde 350 MB (el plan gratis de Supabase llega a 500) |

Los avisos se ven en Más → Avisos y llegan al celu como notificación (`NotificationsWatcher`, cada 15 s), una vez por título. El aviso del tracker conserva el título y lleva la fecha en el detalle: las consultas repetidas no repiten el push.

## Configurar la colección pública del tracker (T-020)

La API necesita `TRACKER_COLLECTION_ANON_KEY`. Su defecto está vacío: la app arranca y el CSV sigue disponible, pero la consulta del tracker devuelve `tracker_config` hasta configurarla. La URL por defecto es la instancia pública de Supabase; `TRACKER_COLLECTION_URL` permite reemplazarla.

Obtener la **clave anon pública** que publica el frontend oficial del tracker en `frontend/src/lib/supabase.ts`, o desde el header `apikey` de una consulta de su frontend a Supabase en las herramientas de red del navegador. Debe ser la clave anon de esa instancia, nunca una `service_role`. No copiar su valor al repositorio, a la bóveda ni al chat.

En producción, cargarla como secreto de Fly de la app `tcg-pocket`: `fly secrets set TRACKER_COLLECTION_ANON_KEY=<valor obtenido> -a tcg-pocket`. Fly la entrega como variable de entorno a la API. También se puede cargar mediante el panel de secretos de Fly. En un servidor sin Fly, definir esa misma variable al iniciar el proceso. Si se rota, reemplazar el secreto y verificar una vista previa manual.

Guardar el friend_id de 16 dígitos en Más → Ajustes → Colección del tracker y habilitar la colección pública en el tracker. `tracker_empty` significa que el conteo fue cero: puede ser un friend_id equivocado, una colección privada o sin filas públicas; nunca se interpreta como una colección de cero copias. `tracker_auth` indica rechazo de la clave configurada.

La automática conserva la primera importación aplicada del tracker y las siete últimas para las comparaciones de sobres; descarta las previas pendientes al crear una nueva y conserva hasta siete descartadas. Sólo persiste filas con copias o marca de coleccionada (y los ids desconocidos para revisarlos). Una consulta sin cambios sólo actualiza `trackerLastCheckedAt`, usada por «Última sincronización», y no agrega importaciones. Si hay dudas de catálogo sin cambios de stock, deja un aviso sin guardar otra foto. El historial CSV se conserva.

Las bajas mayores al 10 %, unidades editadas a mano desde la última aplicación, internal_id desconocidos y un commit remoto diferente del catálogo local dejan una revisión. La comparación del commit remoto utiliza el chequeo de GitHub existente; si no se puede verificar, queda en revisión. Aplicar manualmente requiere confirmar las copias que bajan. «Retirar» ajustes se ofrece en la previa CSV; para el tracker se retiran desde Ajustes y se obtiene otra previa.

El aviso se limpia al aplicar un tracker o CSV, descartar la previa correspondiente, apagar la automática o cambiar/vaciar el friend_id. Restaurar un backup con automática encendida retrasa seis horas la próxima consulta para permitir revisar la colección restaurada.

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

## CLI de producción

Se corren con `flyctl machine exec <id> --app tcg-pocket "node /app/apps/api/dist/cli/<cli>.js …"`: `retention.js` (vista previa; `--apply` borra), `catalog-sync.js`, `owner-init.js` y `worker-timing.js --days 7` (solo lectura: por worker, el tiempo del motor contra el reloj y el hueco entre reclamos).

El `<id>` es el de la máquina que está corriendo: `flyctl machine list --app tcg-pocket`. Cambia cuando un deploy reemplaza la máquina, así que conviene buscarlo cada vez y no copiarlo de una nota vieja. Tampoco se escribe en el repo, que es público.

`catalog-sync.js` dice primero, en stderr, qué va a usar y de dónde sale cada cosa. Por ejemplo: `catalog:sync 1.0.0: tracker 3ab58f1 (the loaded catalog), engine c87bad0 (this build's DEFAULT_ENGINE_REV)`. Sin `--engine-rev` usa `ENGINE_REV` del entorno o, si no hay, el `DEFAULT_ENGINE_REV` de la imagen, nunca el del último sync. Después de mover el pin no hace falta pasarlo.

Desde #75 (DECISIONES 45.51) se pueden correr con la API viva: levantan la app en modo CLI, sin crons ni los hooks de arranque que cambian estado. Tené en cuenta dos cosas:
- el catálogo vive en la memoria del servidor: después de un `catalog-sync` por CLI, la API carga la sincronización nueva sola en menos de un minuto, sin reiniciar. Hasta entonces, `/healthz` y «Acerca de» siguen mostrando el commit y el `engineRev` anteriores: para ver si un sync tomó el motor nuevo, mirá la línea del CLI o esperá ese minuto. Mientras tanto sale el aviso `catalog_memory`; si sigue, porque falló la carga, reiniciá la máquina. «Sincronizar» sin commit repite el último aplicado en la base, no el de la memoria, así que no deshace lo del CLI;
- si una sincronización del catálogo muere a la fuerza (falta de memoria o el tope de `flyctl machine exec`), la API la cierra como «Interrumpida» unos 5 minutos después de su última señal de vida, sin reiniciarse. Sale el aviso `catalog_sync` y «Sincronizar» se habilita de nuevo. Mientras una corre con señales de vida, empezar otra, desde la app o desde el CLI, da 409.

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

## Repositorio (D-022)

- **`santiqwerty1/tcg-pocket` es público desde el 11/10/2026**, bajo AGPL-3.0. El privado anterior es `santiqwerty1/tcg-pocket-historial`: archivado, solo lectura, con los PR originales y sus descripciones. No se le sube nada.
- **Nada de datos personales** en commits, PR, issues ni la bóveda: ni mails (salvo el noreply), ni tokens o secretos, ni la ref de Supabase, ni nombres reales de jugadores de Limitless (van con seudónimos, `scripts/pseudonymize-limitless.mjs`), ni el usuario de Windows en las rutas: se escribe `C:/Users/<usuario>/…`.
- **Los sha citados antes del 11/10** en la bóveda, DECISIONES y las notas son del repo viejo y valen como referencia histórica. En los textos nuevos van los sha del repo público.
- **Ajustes del repo:** permisos por defecto de los workflows en solo lectura; alertas de Dependabot y arreglos de seguridad automáticos prendidos. Al 11/10 hay una alerta baja, de esbuild en `apps/worker` (su servidor de desarrollo en Windows), que no usamos.
- **Cómo se hizo la mudanza:** D-022 y DECISIONES 41.15–41.16. `docs/MUDANZA.md` es el plan anterior, de un solo commit.

## El motor: nuestra copia de deckgym (D-031)

Desde el 15/10/2026 el motor es [santiqwerty1/deckgym-core](https://github.com/santiqwerty1/deckgym-core), una copia de `bcollazo/deckgym-core` con arreglos de reglas. Cada cambio vive en su rama (`fix/…`, `feat/…`, `perf/…`), lista para un PR upstream. Una rama de integración las junta sobre el `main` de upstream, y su sha es el `rev` de `engine/Cargo.toml` y de `engine/wasm/Cargo.toml`.

- **Hasta el 18/10:** la rama `tcg-pocket` (`018b419`), sobre upstream `4e25889` y con seis ramas.
- **Desde el 18/10:** `next/adfe505` (`0b510d1`; desde el 19/10, `c87bad0`), sobre upstream `adfe505`. Lleva solo lo que upstream no tiene: `fix/choose-evolution-target` (PR upstream #420), `feat/bot-api` (los exports del bot g) y, desde `c87bad0`, `perf/value-function-skips-zero-weights` (santiqwerty1/deckgym-core#1: la evaluación base sin los términos de peso 0, con las mismas partidas). Upstream ya integró #383, «et» (#396), `DiscardFossil` (#397) y lo de sin Activo (#398, `d7520fa`).

**Cada sha que fija o fijó `engine/Cargo.toml` lleva una etiqueta `pin-<sha corto>` en la copia** (`pin-018b419`, `pin-0b510d1` y `pin-c87bad0`). Rearmar una rama la reescribe, y sin la etiqueta GitHub puede borrar el commit viejo. Lo siguen buscando por sha `cargo` (el lock, para volver a compilar o volver atrás), el visor del Dockerfile, el catálogo (`ENGINE_RAW_BASE`), el enlace al visor de las repeticiones viejas y las fuentes que promete `docs/LICENCIAS.md`.

Para actualizarla, por ejemplo cuando upstream integra uno de nuestros arreglos:
1. **En la copia:** traer upstream `main`, armar una rama de integración nueva (`next/<sha de upstream>`) y unirle con `--no-ff` las ramas que upstream todavía no tiene, rebasadas encima. Cada una se rebasa en una copia nueva, salvo la de un PR upstream abierto que lo necesite, que se rebasa en su lugar (así se hizo con `fix/choose-evolution-target` para #420). Lo viejo sigue en la etiqueta del pin anterior. Las que upstream ya integró se sacan. Correr `cargo test --release` y `cargo test` en debug de deckgym, y subir la rama. Etiquetar la punta nueva antes de usarla: `git tag pin-<sha corto> <sha>` y `git push fork pin-<sha corto>`. Si upstream no cambió y solo se suma una rama nuestra, entra en la misma rama de integración por un PR de la copia, y la punta nueva se etiqueta igual: así llegó `perf/value-function-skips-zero-weights` a `c87bad0` el 19/10, con `0b510d1` como primer padre.
2. **En tcg-pocket:**
   - poner el sha nuevo en los dos `Cargo.toml` y correr `cargo update -p deckgym` en `engine/` y en `engine/wasm/`;
   - poner el sha en `DEFAULT_ENGINE_REV` (`apps/api/src/config/env.ts`): es el `engineRev` de la API, con el que se arman los trabajos y el sync del catálogo, y si queda el viejo los workers nuevos no pueden reclamar nada. También en el texto de «Acerca de» (`apps/web/src/pages/mas/AboutPage.tsx`) y en `docs/LICENCIAS.md`. Un test de `apps/api/src/config/env.spec.ts` falla si alguno de esos lugares, los locks, las cabeceras de los dorados o el README de la API no coincide con los `Cargo.toml`;
   - los dorados: regenerar con la cabecera vieja todavía en `engine/games-rev.json` (`cargo test --release regenerate_games_rev -- --ignored`). Con la cabecera vieja acepta los casos que cambiaron y escribe él mismo la nueva, y `git diff engine/games-rev.json` los muestra todos. Para el navegador, compilar el motor (`node scripts/build-engine-wasm.mjs --out <carpeta>`) y correr `node engine/wasm/smoke.mjs <carpeta> --regenerate`, que reescribe `engine/wasm/games-wasm.json` con la cabecera nueva. Después, los dos sin regenerar: `cargo test --release` y el smoke sin `--regenerate`. Cada caso que cambió se explica en el PR;
   - `GAMES_REV` no sube por un cambio de deckgym: el trabajo ya lo separa `engineRev`.
3. **El diferencial:** `node scripts/engine-diff.mjs <engine-cli viejo> <engine-cli nuevo> <mazos.jsonl> <carpeta> 10 4 [semilla]`, con los mazos de una prueba contra el meta y la lista de cartas afectadas del script ajustada al cambio, también por lo que traiga upstream. No puede quedar ningún cruce «UNEXPLAINED» ni fallado. Una segunda pasada con otra semilla base juega otras partidas; con la misma semilla y más partidas, repite las primeras.
   - **Si el cambio suma o saca campos de `State`** (`src/state/mod.rs` de deckgym), cambian también partidas sin ninguna carta afectada. `forecast_action` sortea con el hash de `State` las 20 ramas que mira e2 de un efecto con más resultados (`MAX_FORECAST_BRANCHES`), y con otro campo el hash es otro. Así pasó el 18/10 con `has_played_stadium` (#408 de upstream) y Fan de los Perritos, que tiene cientos de resultados.
   - Para separar eso de las reglas, el motor viejo del diferencial es uno de control: el deckgym viejo con los campos nuevos, escritos donde los escribe el código nuevo pero sin la regla nueva. Se arma con una copia de deckgym en el sha viejo con esos cambios, y un `[patch."https://github.com/santiqwerty1/deckgym-core"]` con `deckgym = { path = "…" }` al final de `engine/Cargo.toml`, en una copia de trabajo aparte que no se sube.
   - El control del 18/10 tenía el campo sin escribirlo nunca. Así, una lista con un Estadio puede cambiar por el hash en el turno en que lo juega, aunque no le toque ninguna regla. No pasó: los 200 cruces sin carta afectada, con un Estadio o sin él, dieron idénticos en las dos pasadas.
4. **Al desplegar:** según 45.46, un trabajo que ya jugó algo se vuelve a jugar entero con el motor nuevo. Conviene esperar a que terminen los trabajos largos. Después, un sync del catálogo (`POST /api/catalog/sync`, «Sincronizar» en Más → Catálogo o `catalog-sync.js` sin `--engine-rev`): hasta entonces `/healthz` y «Acerca de» muestran el `engineRev` del catálogo anterior.

El aviso «deckgym tiene commits nuevos» sigue comparando contra upstream `main`: GitHub resuelve el sha de la copia dentro de la red de forks, así que `ahead_by` cuenta los commits de upstream que todavía no trajimos.

## CI (D-023)

**Desde el 11/10/2026 el repo es público y la CI corre en los runners de GitHub** (`ubuntu-latest` y `windows-latest`), que en un repo público son gratis y sin tope de minutos. El repo no tiene las variables `CI_RUNNER`, `CI_RUNNER_LIGHT` ni `CI_RUNNER_WINDOWS`, y sin ellas cada job usa los de GitHub.

**Los runners propios no se usan en el repo público:** un PR de cualquiera correría su código en la PC. `scripts/ci-runner/install.ps1` se niega a registrarlos en un repo público.

### Los runners propios, del 9 al 11/10/2026

Mientras el repo fue privado y sin minutos de Actions, la CI corrió en runners propios:
- **Quiénes:** `tcg-pc-1` y `tcg-pc-2` en esta PC y, desde el 10/10, `tcg-ryzen-1` y `tcg-ryzen-2` en la del Ryzen (`install.ps1 -Prefix tcg-ryzen`), todos con la etiqueta `tcg-pc`.
  - Desde el 11/10, los jobs sin Postgres ni Docker (`changes`, `test` y `engine`) también podían ir a la etiqueta `tcg-light` (variable `CI_RUNNER_LIGHT`), para que el Ryzen ayudara sin tener Postgres ni Docker listos.
- **Cómo:** sin servicio de Windows, en `%USERPROFILE%\actions-runner`, arrancados al iniciar sesión por `tcg-pocket-ci-runners.vbs` en Inicio. Base y puerto propios por runner (`scripts/ci-runner-id.sh`) y el motor compilado con el Rust y el WinLibs de cada PC.
- **Bajas del 11/10:** los cuatro se dieron de baja por la API en el repo viejo, que quedó renombrado a `santiqwerty1/tcg-pocket-historial`. En esta PC se borraron la carpeta y el lanzador de Inicio; en la del Ryzen falta (Santi, el martes 13/10).
- **Si el repo se renombró:** `uninstall.ps1` falla al dar de baja con `config.cmd remove` (NotFound), porque el `.runner` apunta a la URL vieja y esa URL ahora es el repo público. En ese caso:
  1. Darlos de baja por la API, en el repo donde quedaron registrados: `gh api repos/<repo>/actions/runners` da el id, y después `gh api -X DELETE repos/<repo>/actions/runners/<id>`.
  2. Correr igual `powershell -ExecutionPolicy Bypass -File scripts\ci-runner\uninstall.ps1 [-Prefix tcg-ryzen]`, que frena los procesos y borra la carpeta y el lanzador aunque la baja falle.
- **Solo para un repo privado:** `install.ps1 [-Count 2] [-Prefix tcg-pc] [-Repo <dueño/repo>]` sigue andando contra un repo privado. Revisa antes Git, gh con sesión, Docker Desktop, Rust (GNU) y WinLibs. La CI elegiría esos runners con las variables `CI_RUNNER`, `CI_RUNNER_LIGHT` y `CI_RUNNER_WINDOWS`.
- **Nunca `Start-Process`** desde una sesión de Claude para arrancarlos (H-016): `Invoke-CimMethod` sobre el `.vbs` de Inicio.

**Dependabot:** en el repo público están prendidas las alertas y los arreglos de seguridad automáticos. Las actualizaciones de versión vuelven a una vez por mes, agrupadas, con 2 PR de npm y 1 de Actions como máximo (`.github/dependabot.yml`, DECISIONES 41.12).

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
- **Si falla con P1011** (no pudo abrir TLS o no verificó el certificado de la base): las migraciones exigen `sslmode=verify-full` con la CA de `apps/api/certs/` (`NODE_EXTRA_CA_CERTS`). Revisar, en este orden:
  1. que el secreto `DATABASE_URL` lleve `sslmode=verify-full` y apunte al pooler (sin mostrar el secreto: `flyctl machine exec <id> --app tcg-pocket "node -e \"console.log(new URL(process.env.DATABASE_URL).searchParams.get('sslmode'))\""`);
  2. que la CA del repo siga siendo la de Supabase (`certs/README.md`; un solo certificado por archivo);
  3. que la cadena del pooler no haya cambiado (el handshake falla igual con cualquier cliente).
  - **Nunca `DATABASE_TLS=off` en Fly:** es solo para probar la imagen contra un Postgres sin TLS. En producción, la app y las migraciones lo dejan en el log como aviso.
- **Para destrabarla:**
  1. Arreglar la migración en un commit nuevo.
  2. Marcarla como deshecha: `flyctl machine exec <id> --app tcg-pocket "sh -c 'cd /app/apps/api && node node_modules/prisma/build/index.js migrate resolve --rolled-back <nombre_de_la_migración>'"`.
     - Si en realidad se aplicó a mano, va `--applied` en vez de `--rolled-back`.
  3. Desplegar de nuevo.

La CI saltea el motor de Windows cuando no cambió y arma la imagen de Docker solo en main (DECISIONES 41.1–41.3). Dependabot abre como mucho un PR agrupado por mes para npm y otro para las Actions; el motor queda afuera porque deckgym está fijo (D-013).

## Prioridad del worker 0.2.8 (D-023, T-015)

En `config.json`, `"priority": "below_normal"` es el valor por defecto. `TCG_WORKER_PRIORITY` manda sobre el archivo; los otros valores admitidos son `normal` e `idle`. `--check` muestra `priority`. El cambio toma efecto en el siguiente arranque del worker; lo opera el Coordinador.

Cada motor de simulación, lote, consistencia u optimización (incluido explorar) recibe la prioridad inmediatamente después de crearse. Las partidas en vivo contra el bot y las pistas del entrenador piden normal; las situaciones se resuelven desde repeticiones. El proceso del worker conserva la suya para atender latidos y red. Si el sistema rechaza el cambio (por ejemplo permisos en Android), queda un aviso con PID y prioridad en `worker.log` y el trabajo continúa con la prioridad heredada.

[Node documenta las constantes portables](https://nodejs.org/api/os.html#priority-constants): `below_normal` es Below Normal en Windows / nice 10 en Linux y Android; `idle` es Idle / nice 19; normal es Normal / nice 0. La prioridad reparte CPU; no reserva núcleos ni memoria, ni elimina el calor. `engine-cli` conserva la exclusión de EcoQoS (H-001) y su versión 0.3.3.

Medición y comandos para repetirla: [prioridad del worker](WORKER-PRIORIDAD.md).

## Worker en Android arm64 (T-015)

En Más → Tokens de API → «Worker en Android» están los pasos y un comando sin token. Instalá Termux desde [F-Droid](https://f-droid.org/packages/com.termux/) o [GitHub oficial](https://github.com/termux/termux-app#installation), fuera de Play Store. Termux:API y Termux:Boot deben venir del mismo origen que Termux: sus firmas no se pueden mezclar. Creá un token de tipo worker para el celu y pegalo cuando el instalador lo pide oculto dentro de Termux.

El comando baja `/api/worker/install/android.sh` por HTTPS, sin autenticación porque no contiene datos. El script descarga `/api/worker/packages/android-arm64` con Bearer por stdin, verifica `X-Checksum-Sha256` y no sigue redirecciones. Guarda la config en `~/.local/share/tcg-worker-android/data/config.json` (600), conserva la identidad y crea `$PREFIX/bin/tcg-worker`. Node se instala con `pkg install nodejs-lts`: el [paquete oficial consultado el 10/10/2026](https://github.com/termux/termux-packages/blob/master/packages/nodejs-lts/build.sh) es 24.18.0; el JS requiere >=24.

- `tcg-worker`: pide wake-lock y trabaja hasta Ctrl+C/SIGTERM; lo libera al terminar.
- `tcg-worker --check`: determinismo, versión exacta del motor de la imagen, configuración y conexión, sin tomar trabajo.
- Solo mientras carga: requiere Termux:API, `pkg install termux-api` y los permisos que solicite. Cada 15 s revisa si está enchufado (también batería llena); una lectura fallida pausa. Desenchufar corta el motor y devuelve leases sin contar fallas; enchufar inicia otro proceso que reanuda resultados.
- Inicio automático: elegirlo en el instalador, instalar Termux:Boot y abrirlo una vez. Escribe solo `~/.termux/boot/tcg-worker`; su log queda en `data/boot.log`.
- Actualizar: repetir el comando. Primero prueba el motor nuevo, después detiene el viejo por SIGTERM y cambia motor/JS juntos. Conserva el id; si cambió el motor, aparta `state.json` con sufijo `.motor-anterior-...` y los pendientes se vuelven a jugar. No mezclar archivos de paquetes distintos.

Por defecto usa la mitad de los núcleos y respeta ese tope aun si el trabajo pide más. Simular consume batería y calienta, incluso enchufado: empezá con pocos núcleos, dejá ventilación y frenalo si calienta demasiado. El supervisor conserva wake-lock al esperar el cargador; esto también consume energía. En Android → Apps → Termux → Batería, elegí «Sin restricciones» o excluí la optimización; aplicalo también a Termux:API y habilitá el inicio automático del fabricante si existe. El wake-lock no impide cierres por memoria o por políticas del fabricante. SIGKILL no permite cleanup; sin red al apagar, los leases vencen en 3 minutos.

### Restricciones de procesos de Android 12+

[Guía mantenida por un desarrollador de Termux](https://github.com/agnostic-apollo/Android-Docs/blob/master/en/docs/apps/processes/phantom-cached-and-empty-processes.md), consultada el 10/10/2026. Los nombres de las opciones varían por fabricante:

- Android 14+: Opciones de desarrollador → «Disable child process restrictions» / «Desactivar restricciones de procesos secundarios». Mantené las opciones de desarrollador activadas; al desactivarlas se revierte este toggle.
- Android 12L/13 y superiores: desde una PC con adb autorizado, `adb shell settings put global settings_enable_monitor_phantom_procs false`. Verificar: `adb shell settings get global settings_enable_monitor_phantom_procs`. Deshacer: `adb shell settings delete global settings_enable_monitor_phantom_procs`.
- Android 12 original: no ofrece un ajuste para impedir la matanza por CPU excesiva. Para ampliar el límite de procesos: `adb shell device_config set_sync_disabled_for_tests persistent` y `adb shell device_config put activity_manager max_phantom_processes 2147483647`. Deshacer: `adb shell device_config delete activity_manager max_phantom_processes` y `adb shell device_config set_sync_disabled_for_tests none`. La guía describe las limitaciones de Google Play Services y cada fabricante.

Son cambios globales del dispositivo. El instalador no los ejecuta. El LEEME del paquete lleva los mismos pasos.

### Construir y verificar sin el teléfono

`pnpm -F @tcg/worker package:android` requiere Docker y arma `apps/worker/build/tcg-worker-0.2.8-android-arm64.tar.gz`; la versión sale de `WORKER_VERSION`. Fly lo construye dentro de su imagen con el target `android-package` y Cargo con locks y cachés de BuildKit. En runtime solo se copian el tar, el instalador y el manifiesto de versión: no Rust, Zig ni qemu. No hay que subir un artefacto separado ni guardar credenciales de GitHub en el servidor.

Con Linux/WSL y qemu-user, extraé el tar en una carpeta temporal y corré `node apps/worker/scripts/check-arm.mjs <carpeta>/tcg-worker`. Repite la referencia con 1 y 2 hilos. La CI ejecuta esto y la prueba SIGTERM con servidor/motor de mentira. La prueba local ARM coincidió con Windows: 24 partidas con r/e2/f2, semilla 20261010, 1 y 2 hilos; comparar totales y cada partida, excluyendo tiempos/rutas. Falta el teléfono real: musl ejecutable, permisos API, calor, suspensión y Boot se verifican ahí con `--check` y una simulación chica.

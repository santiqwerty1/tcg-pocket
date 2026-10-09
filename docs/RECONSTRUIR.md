# Reconstruir desde cero

Qué hacer si se pierde la base (Supabase), la app de Fly o las dos (Fase 39, R-006). La copia diaria está en dos lugares:
- en la base misma (`backup_blobs`, las últimas 14);
- en el bucket de Tigris en Fly (`backups/`, las últimas 30).

Si se perdió Supabase, la del bucket es la que sirve.

## Qué vuelve y qué no

| Vuelve con la copia | No vuelve: se rehace |
|---|---|
| Colección (stock, importaciones, ajustes), mazos con sus revisiones, partidas, sobres y puntos guardados, reglas de rareza, ajustes, tabla de eras y fusiones de arquetipos, notas por rival, eventos, resultados de las partidas contra el bot | Usuario y TOTP (`owner:init`), tokens de API (el conector de Claude y cada worker), catálogo (se vuelve a bajar al commit de la copia), torneos de Limitless (el backfill de 60 días los baja solo), simulaciones y sus repeticiones, suscripciones a notificaciones |

## 1. Bajar la copia más nueva

**Del bucket** (si la app no anda):
1. `flyctl storage list` muestra el bucket y `flyctl storage dashboard <bucket>` abre su consola en Tigris.
2. Bajar el `backups/tcg-pocket-<fecha>.json.gz` más nuevo.

**Con un cliente S3**, por ejemplo `aws` con el endpoint de Tigris:
```bash
aws s3 ls s3://<bucket>/backups/ --endpoint-url https://fly.storage.tigris.dev
aws s3 cp s3://<bucket>/backups/<archivo> . --endpoint-url https://fly.storage.tigris.dev
```
- Las claves salen de `flyctl storage create`.
- Si se perdieron, se generan unas nuevas desde la consola de Tigris.
- Nunca se pegan en el chat.

**De la app** (si sigue andando): Más → Copia de seguridad → descargar.

## 2. Una base nueva

1. **Proyecto nuevo en Supabase**, en la región São Paulo y el plan Free.
2. **`DATABASE_URL` del pooler en modo sesión**, puerto 5432, con `sslmode=verify-full`. Los detalles y el certificado están en `apps/api/README.md`.
3. **Cargarla como secreto:** `flyctl secrets set DATABASE_URL=… --app tcg-pocket`. Va desde `.env.fly`, nunca por el chat.

## 3. La app

**Si se perdió la app de Fly:**
1. `flyctl apps create tcg-pocket`.
2. Los secretos:
   - `SESSION_SECRET` (32 caracteres o más, nuevo);
   - `DATABASE_URL`;
   - `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`: generarlas de nuevo como dice CLAUDE.md. Cada celu vuelve a activar las notificaciones.
3. El bucket: `flyctl storage create`, que deja los `AWS_*` y `BUCKET_NAME`.

**Desplegar:** `pnpm deploy:fly`. Las migraciones corren solas: dejan la base vacía con el esquema actual.

**El usuario:** `flyctl machine exec <id> --app tcg-pocket "node /app/apps/api/dist/cli/owner-init.js"`, con `OWNER_EMAIL` y `OWNER_PASSWORD` en el entorno de ese comando.
- Imprime el secreto TOTP una sola vez: cargarlo en la app de autenticación en ese momento.

**El catálogo, al commit de la copia:**
1. El `catalogCommit` está en el JSON de la copia, adentro del `.json.gz`.
2. `flyctl machine exec <id> --app tcg-pocket "node /app/apps/api/dist/cli/catalog-sync.js --commit <catalogCommit>"`.
3. Después `flyctl machine restart <id>`: el catálogo vive en memoria.

## 4. Restaurar

1. Entrar a la app con el usuario nuevo.
2. En Más → Copia de seguridad → Restaurar, subir el `.json.gz`:
   - primero sale el **ensayo**: qué cambia, tabla por tabla;
   - después, **Reemplazar**.
3. Si la copia es de otro commit del catálogo, el aviso `needs_review` pide revisar la colección y los mazos.
4. La primera vez, después de restaurar, correr la **Prueba de restauración** (Más → Copia de seguridad). Compara la base con el archivo.

## 5. Lo que queda afuera

- **Tokens:** Más → Tokens de API.
  - Uno `mcp` nuevo para el conector de Claude; cambiarlo en «Encabezados de solicitud» del conector.
  - Uno `worker` por PC; correr `tcg-worker.exe` de nuevo, o editar `%LOCALAPPDATA%\tcg-worker\config.json`.
- **Torneos:** el primer sync de Limitless baja 60 días solo. Si hace falta más: `POST /api/tournaments/sync` con `{ "backfillDays": 120 }`.
- **Simulaciones:** se vuelven a encolar. Las semillas y el motor fijo dan los mismos resultados.
- **UptimeRobot:** si cambió la URL, actualizar el monitor (`docs/OPERACION.md`).
- **Comprobar:**
  - `GET /api/ops/status`, o `system_status` desde Claude: versión, base, copia, catálogo y workers;
  - y que Más → Avisos esté vacío.

## Retención

- **Limpieza diaria a las 04:20**, después de la copia. Se puede ver antes qué borraría con `POST /api/ops/retention`, que es solo una vista previa; `?apply=1` la corre.
  - Borra las repeticiones de las simulaciones archivadas o terminadas hace más de 30 días.
  - Deja una sola repetición por cruce en las matrices.
  - Mantiene todas las repeticiones juntas por debajo de 100 MB.
  - Borra los crudos de standings de los torneos de más de 180 días.
- **No toca** resultados, listas de torneo ni nada de la colección, los mazos o las partidas.
- **Una repetición borrada se puede volver a jugar:** el chunk guarda su semilla y el motor está fijo.

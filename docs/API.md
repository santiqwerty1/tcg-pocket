# Contrato REST · Fase 1

Contrato entre `apps/api` (NestJS) y `apps/web` (PWA). Identificadores en inglés; mensajes para el usuario en español. Todas las rutas van bajo `/api` y exigen la cookie de sesión salvo las marcadas como públicas. JSON en ambas direcciones salvo descargas.

## Convenciones

- Errores: `{ "error": { "code": "snake_case", "message": "texto en español", "details"?: … } }` con el status HTTP apropiado (400 validación, 401 sin sesión, 403 sin permiso/scope, 404, 409 conflicto, 429 límite).
- Sin sesión: las navegaciones (`Accept: text/html`) reciben `302 /login`; las llamadas a `/api/*` reciben `401 { error: { code: "unauthenticated" } }`.
- Paginación: `?limit=50&offset=0` → `{ items: [...], total }`.
- Porcentajes (desde la Fase 2): siempre `{ value, games, samples, sampleKind, ci95: [lo, hi], orientative }`.
- Fechas en ISO 8601 UTC. Ids de carta = `card_id` del tracker (`A1-1`, `B4b-372`); ids de grupo funcional = `card_id` más temprano del grupo.
- Todo texto de reglas de cartas viene en inglés; `nameEs` siempre presente.
- Los ids numéricos de la base (mazos, ajustes, importaciones, copias de seguridad, tokens) viajan **como strings** en todas las respuestas (`"12"`), también dentro de `variantOfId`, `adjustmentId` y `decks[].id`; en las rutas se aceptan tal cual. Un id que no es un entero positivo responde `404`.
- Booleanos en la query (`missingOnly`, `onlyOwned`, `active`, `archived`, `builtInGame`) se escriben `true`/`false` (también `1`/`0`); otro valor da `400 validation`.
- `imageUrl` puede ser `null` (hoy siempre es un enlace al raw del tracker, I11).

## Públicas

| Método y ruta | Descripción |
|---|---|
| `GET /healthz` | `{ ok: true, version, catalogCommit, engineRev }` |
| `GET /login` | Página HTML autónoma de inicio de sesión (email, contraseña, código TOTP) |
| `POST /api/auth/login` | `{ email, password, totp? }` → `204` + cookie. Límite 5 intentos / 15 min por IP (`429`). |
| `/api/mcp`, `/api/worker/*` | Con `Authorization: Bearer tcg_mcp_…` / `tcg_wk_…` (Fases 3 y 6). Sin token válido: `401`. |

## Sesión

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `POST /api/auth/logout` | `204`, borra la cookie |
| `GET /api/auth/me` | `{ email, totpEnabled }` |
| `POST /api/auth/password` | `{ currentPassword, newPassword }` → `204` |

## Tokens de API

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/tokens` | `{ items: [{ id, name, kind: 'worker'|'mcp', scopes, prefix, lastUsedAt, expiresAt, revokedAt, createdAt }] }` |
| `POST /api/tokens` | `{ name, kind, scopes: string[] }` → `201 { id, token }` (el token completo se muestra una sola vez) |
| `DELETE /api/tokens/:id` | Revoca → `204` |

## Catálogo

| Método y ruta | Respuesta |
|---|---|
| `GET /api/catalog/status` | `{ trackerCommit, engineRev, syncedAt, counts: { cards, groups, stockUnits, expansions, packs }, lastSync: { id, status, startedAt, finishedAt, report } | null }` |
| `POST /api/catalog/sync` | `{ commit?, engineRev?, fromFixtures? }` → `202 { syncId }`; corre en segundo plano; estado en `status`; `409` si ya hay uno corriendo |
| `GET /api/expansions` | `{ items: Expansion[] }` con `packs: Pack[]` (sin `cardIds`) |
| `GET /api/cards?q=&lang=es|en|any&limit=20` | `{ items: CardSearchHit[] }` donde `CardSearchHit = { card: CardSummary, group: GroupSummary, score, matchedOn }`; con `?expansion=A1` y sin `q`: `{ items: CardSummary[], total }` |
| `GET /api/cards/:cardId` | `{ card: CardEdition, group: GroupDetail }` |
| `GET /api/groups/:groupId` | `{ group: GroupDetail }` |

Tipos:

```ts
CardSummary = { id, nameEs, nameEn, expansionId, number, rarity, cardType, evolutionType, ex, prizePoints, imageUrl, functionalGroupId, stockCardId, isDisplayEdition }
GroupSummary = { id, nameEs, nameEn, cardType, displayCardId, editionCount }
GroupDetail = GroupSummary & {
  playable: number, fromStock: number,
  adjustment: { id, playableCopies, reason, createdAt } | null,   // id string
  editions: [{ card: CardSummary, owned: number, collected: boolean, twinCardIds: string[] }],
  decks: [{ id, name, count, builtInGame }]   // mazos que usan el grupo
}
```

## Colección

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/collection/summary` | `{ copies, stockUnitsCollected, groupsWithAtLeast: { one, two }, groupsMissing, lastImportAt, activeAdjustments }` |
| `GET /api/collection/groups?q=&expansion=&missingOnly=&limit=&offset=` | `{ items: [{ group: GroupSummary, playable, fromStock, hasAdjustment }], total }` (vista por carta funcional) |
| `GET /api/collection/stock?q=&expansion=&onlyOwned=&limit=&offset=` | `{ items: [{ card: CardSummary, owned, collected, twinCardIds }], total }` (vista por edición) |
| `PATCH /api/collection/stock/:cardId` | `{ amountOwned?, collected? }` (al menos uno) → `{ stockCardId, cardIds, affectedTwinIds, before: { amountOwned, collected } | null, after, activeAdjustment: { id, functionalGroupId, nameEs, playableCopies, reason, createdAt } | null }` (la UI pregunta si retirar el ajuste cuando `activeAdjustment` no es null; `collected` pasa a `true` solo cuando la cantidad sube de 0) |
| `POST /api/collection/imports` | `multipart/form-data` con `file` (CSV, ≤ 5 MB) **o** JSON `{ csv: string }` → `201 ImportPreview` (estado `pending`); `400 invalid_csv` si el archivo no tiene las columnas del tracker (`details` lista los errores); `413` si pesa más de 5 MB |
| `GET /api/collection/imports` | `{ items: [{ id, fileName, importedAt, appliedAt, status, rowCount, naiveTotal, dedupTotal, blocked, summary }] }` (más reciente primero) |
| `GET /api/collection/imports/:id` | `ImportPreview` completo; mientras está `pending` el diff se recalcula contra el stock actual, una vez aplicada muestra el diff que se aplicó |
| `POST /api/collection/imports/:id/apply` | Aplica el import pendiente (una transacción; solo se escriben las unidades que cambian, con `source = import`) → `{ applied: true, summary }`; `409 import_not_pending` si ya no está pendiente, `409 import_blocked` si tiene errores de fila o gemelas con valores distintos |
| `POST /api/collection/imports/:id/discard` | → `204`; `409 import_not_pending` si ya no está pendiente |
| `GET /api/collection/export.csv` | Descarga `tcgcollectiontracterexport.csv` (BOM, LF, formato del tracker) |
| `GET /api/collection/adjustments?active=true` | `{ items: CollectionAdjustment[] }` (sin `active`: todos, activos primero) |
| `POST /api/collection/adjustments` | `{ functionalGroupId, playableCopies, reason? }` → `201 CollectionAdjustment`; `404` si el grupo no existe; `409 adjustment_active` si ya hay uno activo para el grupo |
| `POST /api/collection/adjustments/:id/resolve` | `{ resolution: 'user'|'csv_matches'|'manual_edit' }` → `CollectionAdjustment` desactivado; `409 adjustment_inactive` si ya estaba resuelto |
| `POST /api/collection/adjustments/:id/convert` | `{ targetCardId }` → aplica el plan de conversión (edición manual de esa edición para que la suma del stock iguale el ajuste) y resuelve con `converted`: `{ adjustment, stockCardId, affectedTwinIds, before, after }`; `400 conversion_target_not_in_group` / `conversion_negative_amount` con mensaje si no es posible, `404` carta desconocida, `409 adjustment_inactive` |

```ts
CollectionAdjustment = { id, functionalGroupId, nameEs, playableCopies, fromStock, reason, active, createdAt, resolvedAt, resolution: 'user'|'csv_matches'|'manual_edit'|'converted'|'catalog_change'|null }
```

```ts
ImportPreview = {
  id, fileName: string | null (null cuando se pegó como { csv }), status: 'pending'|'applied'|'discarded', importedAt, appliedAt, sha256,
  rowCount (filas que parsearon), naiveTotal, dedupTotal, bom, lineEnding: 'LF'|'CRLF'|'mixed',
  errors: [{ line, code, column, message }],            // filas que no parsearon (no se importan; bloquean apply)
  unknownIds: string[],                                   // ids que no están en el catálogo (sus filas se ignoran, no bloquean)
  internalIdMismatches: number,                           // filas cuyo InternalId difiere del catálogo (otra versión del tracker)
  twinConflicts: [{ stockCardId, rows: [{ cardId, line, amountOwned, collected }] }],  // gemelas con valores distintos (bloquean apply)
  blocked: boolean,                                       // errors.length > 0 || twinConflicts.length > 0
  summary: { unitsChanged, copiesDelta, newUnits, zeroedUnits, collectedChanged },
  changes: [{ stockCardId, cardIds, nameEs, before: { amountOwned, collected } | null, after: {...} }],  // ordenados por expansión/número
  adjustmentsMatching: [{ adjustmentId, groupId, nameEs, playableCopies, stockSum }],
  adjustmentsHidingChange: [{ adjustmentId, groupId, nameEs, playableCopies, sumBefore, sumAfter }]
}
```

## Mazos

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/decks?tag=&archived=false&builtInGame=` | `{ items: DeckSummary[] }` en orden de creación; sin `archived` lista solo los no archivados, `archived=true` solo los archivados |
| `POST /api/decks` | `DeckInput` → `201 DeckDetail` (se crea aunque tenga errores de validación: `valid: false`; cartas o energías vacías valen). `400 unknown_card` si algún `cardId` no existe en el catálogo (`details` lista los ids). Las entradas repetidas de una misma edición se suman |
| `GET /api/decks/:id` | `DeckDetail` |
| `PATCH /api/decks/:id` | `Partial<DeckInput> & { builtInGame?, archived?, note? }` → `DeckDetail`; crea una revisión (`source: 'ui'`, con `note`) solo si cambian cartas o energías; registra en `changes` los cambios de `name`, `tags`, `notes`, `packPriority`, `variantOf`, `builtInGame` y `archived`; `409 { code: 'built_in_game_limit' }` al superar 25 no archivados; `400` si `variantOfId` es el propio mazo |
| `DELETE /api/decks/:id` | Borra (solo si está archivado) → `204`; `409 deck_not_archived` si no lo está |
| `POST /api/decks/:id/duplicate` | `{ name? }` (default «<nombre> (copia)») → `201 DeckDetail` con `variantOfId` = el original, revisión 1 con `source: 'duplicate'` |
| `POST /api/decks/:id/revisions/:number/restore` | → `DeckDetail` (nueva revisión con `source: 'restore'` y nota «Restaurada la revisión N»; si la revisión pedida es idéntica a la actual no se crea nada); `404` si no existe |
| `GET /api/decks/:id/export?format=spanish|deckgym|limitless|json` | `text/plain` (o `application/json`), `Content-Disposition: inline; filename*=…`; `spanish` incluye el encabezado `### Nombre` y siempre `- Energía:`; deckgym siempre con `Energy:` (`400 energy_required` si el mazo no tiene energía elegida); sin `format`: `spanish` |
| `POST /api/decks/validate` | `{ text?, format?: 'spanish'|'spanish-file'|'limitless'|'json'|'auto', cards?, energies? }` → `{ draft, validation, completeness }` sin guardar; si el texto no parsea, `draft: null` y `validation.errors` trae los errores de parseo; con un archivo de varios mazos se valida el primero |
| `POST /api/decks/import` | `{ text, format?: 'auto'|'spanish'|'spanish-file'|'limitless'|'json' }` → `{ drafts: ImportedDeckDraft[] }` (vista previa; `spanish-file` acepta el archivo completo de 40 mazos con su tabla resumen) |
| `POST /api/decks/import/commit` | `{ decks: DeckInput[] }` → `201 { created: DeckSummary[] }` (todos o ninguno, en una transacción; revisión 1 con `source: 'import'`) |
| `GET /api/decks/by-card/:groupId` | `{ items: [{ id, name, count, builtInGame }] }` (mazos no archivados cuya revisión actual usa alguna edición del grupo; mismo contenido que `GroupDetail.decks`) |

Detección `auto`: texto que empieza con `{` → `json`; una tabla con fila `| # |` **o** dos o más encabezados `### N.` → `spanish-file`; un encabezado `### N.` o líneas `Pokémon:` / `Entrenadores:` / `Energía:` → `spanish`; lo demás → `limitless` (formato de líneas de Limitless/deckgym).

```ts
ImportedDeckDraft = {
  number: number | null, title: string | null,
  draft: DeckDraft | null,                 // null cuando hubo errores de parseo
  errors: ParseIssue[], warnings: ParseIssue[],
  validation: Validation | null, completeness: Completeness | null   // null cuando draft es null
}
ParseIssue = { code, message, line?, candidates? }
DeckDraft = { name?, energies: SelectableEnergy[], cards: [{ cardId, count }], notes?, source? }
```

Cuando la lista dice «Cualquiera» (o la tabla resumen lo dice para ese número) el ítem trae el `draft` con `energies: []` y la advertencia `energy_choice_required` (en `warnings`; `validation.errors` trae `energy_required`): la UI elige la energía antes de confirmar. Sin ninguna indicación de energía la advertencia es `energy_missing`.

```ts
DeckInput = { name, energies: SelectableEnergy[], cards: [{ cardId, count }], tags?: string[], notes?: string, variantOfId?: string | null, packPriority?: 0|1|2|3 }
DeckSummary = { id, name, energies, tags, builtInGame, variantOfId: string | null, packPriority, archivedAt, valid, errorCount, complete, missingCount, cardCount, createdAt, updatedAt, revisionNumber }
DeckDetail = DeckSummary & {
  cards: [{ card: CardSummary, count, group: GroupSummary, playable, missing }],   // una entrada por edición, en el orden de la lista
  validation: { ok, errors: Issue[], warnings: Issue[], infos: Issue[] },
  completeness: { complete, missing: [{ groupId, nameEs, need, have, cardIds }], missingCount },
  revisions: [{ number, createdAt, source: 'ui'|'import'|'mcp'|'duplicate'|'restore', note, cardCount, energies }],
  changes: [{ field, old, new, at, source }],
  notes: string
}
Issue = { code, message, cardIds?: string[] }
```

## Copia de seguridad

| Método y ruta | Respuesta |
|---|---|
| `GET /api/backup/export` | Descarga `tcgpocket-backup-AAAAMMDD.json.gz` (`application/gzip`; todo lo propio de la Fase 1, ver abajo y PLAN §3.9) |
| `POST /api/backup/import?mode=dry-run|replace` | `multipart/form-data` con `file` (`.json.gz` o `.json`, ≤ 50 MB); sin `mode`: `dry-run` → `{ schemaVersion, exportedAt, appVersion, catalogCommit, diff: { current, incoming, notices: string[], needsReview, unknownCardIds } }` (`current`/`incoming` son conteos por tabla); `replace` → `{ applied: true, counts, notices }`. Errores: `400 invalid_backup` (no es gzip/JSON o no tiene la forma), `400 unsupported_schema` (otro `schemaVersion`), `400 unknown_card` en `replace` si referencia cartas o grupos que no están en el catálogo cargado |
| `GET /api/backup/blobs` | `{ items: [{ id, createdAt, sizeBytes }] }` (copias diarias guardadas, más reciente primero; se conservan las últimas 14) |
| `GET /api/backup/blobs/:id` | Descarga (`application/gzip`, nombre con la fecha de la copia) |

Documento (`schemaVersion: 1`): `{ schemaVersion, exportedAt, appVersion, catalogCommit, engineRev, settings[], rarityRules[], collection: { stock[], imports[] (metadatos + filas, sin el archivo crudo), adjustments[] }, decks[] (con `revisions[]` y `changes[]`), tokens[] (solo metadatos: no se restauran) }`, con los ids numéricos y las fechas de la base, así `replace` deja una base idéntica (y un nuevo `export` igual salvo `exportedAt`). `replace` corre en una transacción: borra mazos, ajustes, stock, importaciones y configuración, inserta todo con sus ids, reconstruye `deck_cards` y reajusta las secuencias; `rarity_rules` se pisan por rareza. Si `catalogCommit` difiere del catálogo cargado, `notices` avisa `needs_review` (el remapeo I12 sigue pendiente). La copia diaria (04:00, `BACKUP_CRON`) guarda el mismo documento en `backup_blobs`.

## Configuración

| Método y ruta | Respuesta |
|---|---|
| `GET /api/settings` | `{ [key]: value }` (solo las claves guardadas) |
| `PUT /api/settings/:key` | `{ value }` (cualquier JSON) → `{ key, value }`; `400 validation` si la clave no es una de `ui`, `alpha`, `rarityFilter`, `tradeableRarities`, `rarityCosts`, `minPlayers`, `backfillDays`, `cores`, `defaultBot`, `packModel` |

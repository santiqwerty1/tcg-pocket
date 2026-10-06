# Contrato REST · Fase 1

Contrato entre `apps/api` (NestJS) y `apps/web` (PWA). Identificadores en inglés; mensajes para el usuario en español. Todas las rutas van bajo `/api` y exigen la cookie de sesión salvo las marcadas como públicas. JSON en ambas direcciones salvo descargas.

## Convenciones

- Errores: `{ "error": { "code": "snake_case", "message": "texto en español", "details"?: … } }` con el status HTTP apropiado (400 validación, 401 sin sesión, 403 sin permiso/scope, 404, 409 conflicto, 429 límite).
- Sin sesión: las navegaciones (`Accept: text/html`) reciben `302 /login`; las llamadas a `/api/*` reciben `401 { error: { code: "unauthenticated" } }`.
- Paginación: `?limit=50&offset=0` → `{ items: [...], total }`.
- Porcentajes (desde la Fase 2): siempre `{ value, games, samples, sampleKind, ci95: [lo, hi], orientative }`.
- Fechas en ISO 8601 UTC. Ids de carta = `card_id` del tracker (`A1-1`, `B4b-372`); ids de grupo funcional = `card_id` más temprano del grupo.
- Todo texto de reglas de cartas viene en inglés; `nameEs` siempre presente.

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
| `POST /api/catalog/sync` | `{ commit?, engineRev? }` → `202 { syncId }`; corre en segundo plano; estado en `status` |
| `GET /api/expansions` | `{ items: Expansion[] }` con `packs: Pack[]` (sin `cardIds`) |
| `GET /api/cards?q=&lang=es|en|any&limit=20` | `{ items: CardSearchHit[] }` donde `CardSearchHit = { card: CardSummary, group: GroupSummary, score }` |
| `GET /api/cards/:cardId` | `{ card: CardEdition, group: GroupDetail }` |
| `GET /api/groups/:groupId` | `{ group: GroupDetail }` |

Tipos:

```ts
CardSummary = { id, nameEs, nameEn, expansionId, number, rarity, cardType, evolutionType, ex, prizePoints, imageUrl, functionalGroupId, stockCardId, isDisplayEdition }
GroupSummary = { id, nameEs, nameEn, cardType, displayCardId, editionCount }
GroupDetail = GroupSummary & {
  playable: number, fromStock: number,
  adjustment: { id, playableCopies, reason, createdAt } | null,
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
| `PATCH /api/collection/stock/:cardId` | `{ amountOwned?, collected? }` → `{ stockCardId, affectedTwinIds, before, after, activeAdjustment: {...} | null }` (la UI pregunta si retirar el ajuste cuando `activeAdjustment` no es null) |
| `POST /api/collection/imports` | `multipart/form-data` con `file` (CSV) **o** JSON `{ csv: string }` → `201 ImportPreview` (estado `pending`) |
| `GET /api/collection/imports` | `{ items: [{ id, fileName, importedAt, appliedAt, status, rowCount, naiveTotal, dedupTotal, summary }] }` |
| `GET /api/collection/imports/:id` | `ImportPreview` completo |
| `POST /api/collection/imports/:id/apply` | Aplica el import pendiente → `{ applied: true, summary }`; `409` si ya no está pendiente |
| `POST /api/collection/imports/:id/discard` | → `204` |
| `GET /api/collection/export.csv` | Descarga `tcgcollectiontracterexport.csv` (BOM, LF, formato del tracker) |
| `GET /api/collection/adjustments?active=true` | `{ items: CollectionAdjustment[] }` |
| `POST /api/collection/adjustments` | `{ functionalGroupId, playableCopies, reason }` → `201`; `409` si ya hay uno activo para el grupo |
| `POST /api/collection/adjustments/:id/resolve` | `{ resolution: 'user'|'csv_matches'|'manual_edit' }` → desactiva |
| `POST /api/collection/adjustments/:id/convert` | `{ targetCardId }` → aplica el plan de conversión (edición manual) y resuelve con `converted`; `400` con mensaje si no es posible |

```ts
ImportPreview = {
  id, fileName, status: 'pending'|'applied'|'discarded', importedAt, appliedAt,
  rowCount, naiveTotal, dedupTotal, bom, lineEnding,
  errors: [{ line, code, message }], unknownIds: string[], twinConflicts: [...],
  summary: { unitsChanged, copiesDelta, newUnits, zeroedUnits, collectedChanged },
  changes: [{ stockCardId, cardIds, nameEs, before: { amountOwned, collected } | null, after: {...} }],  // ordenados por expansión/número
  adjustmentsMatching: [{ adjustmentId, groupId, nameEs, playableCopies }],
  adjustmentsHidingChange: [{ adjustmentId, groupId, nameEs, playableCopies, sumBefore, sumAfter }]
}
```

## Mazos

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/decks?tag=&archived=false&builtInGame=` | `{ items: DeckSummary[] }` |
| `POST /api/decks` | `DeckInput` → `201 DeckDetail` (se crea aunque tenga errores de validación; `valid: false`) |
| `GET /api/decks/:id` | `DeckDetail` |
| `PATCH /api/decks/:id` | `Partial<DeckInput> & { builtInGame?, archived?, note? }` → `DeckDetail`; crea una revisión si cambian cartas o energías; `409 { code: 'built_in_game_limit' }` al superar 25 |
| `DELETE /api/decks/:id` | Borra (solo si está archivado) → `204` |
| `POST /api/decks/:id/duplicate` | `{ name? }` → `201 DeckDetail` con `variantOfId` |
| `POST /api/decks/:id/revisions/:number/restore` | → `DeckDetail` (nueva revisión con `source: 'restore'`) |
| `GET /api/decks/:id/export?format=spanish|deckgym|limitless|json` | `text/plain` (o `application/json`); deckgym siempre con `Energy:` |
| `POST /api/decks/validate` | `{ text?, format?: 'spanish'|'limitless'|'json'|'auto', cards?, energies? }` → `{ draft, validation, completeness }` sin guardar |
| `POST /api/decks/import` | `{ text, format?: 'auto'|'spanish'|'spanish-file'|'limitless'|'json' }` → `{ drafts: [{ number?, title?, draft, errors, warnings, validation, completeness }] }` (vista previa; `spanish-file` acepta el archivo completo de 40 mazos con su tabla resumen) |
| `POST /api/decks/import/commit` | `{ decks: DeckInput[] }` → `201 { created: DeckSummary[] }` |
| `GET /api/decks/by-card/:groupId` | `{ items: [{ id, name, count, builtInGame }] }` |

```ts
DeckInput = { name, energies: SelectableEnergy[], cards: [{ cardId, count }], tags?: string[], notes?: string, variantOfId?: string, packPriority?: 0|1|2|3 }
DeckSummary = { id, name, energies, tags, builtInGame, variantOfId, packPriority, archivedAt, valid, errorCount, complete, missingCount, cardCount, updatedAt, revisionNumber }
DeckDetail = DeckSummary & {
  cards: [{ card: CardSummary, count, group: GroupSummary, playable, missing }],
  validation: { ok, errors: Issue[], warnings: Issue[], infos: Issue[] },
  completeness: { complete, missing: [{ groupId, nameEs, need, have, cardIds }], missingCount },
  revisions: [{ number, createdAt, source, note, cardCount }],
  changes: [{ field, old, new, at, source }],
  notes
}
Issue = { code, message, cardIds?: string[] }
```

## Copia de seguridad

| Método y ruta | Respuesta |
|---|---|
| `GET /api/backup/export` | Descarga `tcgpocket-backup-AAAAMMDD.json.gz` (todo lo propio; ver PLAN §3.9) |
| `POST /api/backup/import?mode=dry-run|replace` | `multipart/form-data` con `file` → `{ schemaVersion, catalogCommit, diff: {...} }` en dry-run; `{ applied: true, counts }` en replace |
| `GET /api/backup/blobs` | `{ items: [{ id, createdAt, sizeBytes }] }` (copias diarias guardadas) |
| `GET /api/backup/blobs/:id` | Descarga |

## Configuración

| Método y ruta | Respuesta |
|---|---|
| `GET /api/settings` | `{ [key]: value }` |
| `PUT /api/settings/:key` | `{ value }` → `{ key, value }` |

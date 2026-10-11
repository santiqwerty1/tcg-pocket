# Contrato REST · Fases 1 a 5

Contrato entre `apps/api` (NestJS) y `apps/web` (PWA). Identificadores en inglés; mensajes para el usuario en español. Todas las rutas van bajo `/api` y exigen la cookie de sesión salvo las marcadas como públicas. JSON en ambas direcciones salvo descargas.

## Convenciones

- Errores: `{ "error": { "code": "snake_case", "message": "texto en español", "details"?: … } }` con el status HTTP apropiado (400 validación, 401 sin sesión, 403 sin permiso/scope, 404, 409 conflicto, 429 límite).
- Sin sesión: las navegaciones (`Accept: text/html`) reciben `302 /login`; las llamadas a `/api/*` reciben `401 { error: { code: "unauthenticated" } }`.
- Escrituras de otro sitio: una petición que no sea GET/HEAD/OPTIONS con `Sec-Fetch-Site: cross-site` o con un `Origin` distinto del de la app recibe `403 { error: { code: "forbidden" } }` (no aplica a `/api/mcp` ni `/api/worker/*`, que usan token).
- Paginación: `?limit=50&offset=0` → `{ items: [...], total }`.
- Porcentajes (desde la Fase 2): `WinRate = { source: 'matches'|'tournament'|'simulation', value, games, samples, sampleKind: 'matches'|'lists'|'simulations', ci95: [lo, hi], orientative }`, en porcentaje 0–100 sin redondear (la UI muestra el valor con hasta 1 decimal y el intervalo con 1). `games = V + D + E` alimenta Wilson 95 %; `orientative` es `samples < 30`. Sin partidas el campo es `null` («sin datos»), nunca `0`. Cada fila trae además `record: { wins, losses, ties }`. Las tres fuentes nunca se combinan en un número.
- Fechas en ISO 8601 UTC. Ids de carta = `card_id` del tracker (`A1-1`, `B4b-372`); ids de grupo funcional = `card_id` más temprano del grupo.
- Todo texto de reglas de cartas viene en inglés; `nameEs` siempre presente.
- Los ids numéricos de la base (mazos, ajustes, importaciones, copias de seguridad, tokens) viajan **como strings** en todas las respuestas (`"12"`), también dentro de `variantOfId`, `adjustmentId` y `decks[].id`; en las rutas se aceptan tal cual. Un id que no es un entero positivo responde `404`.
- Booleanos en la query (`missingOnly`, `onlyOwned`, `active`, `archived`, `builtInGame`) se escriben `true`/`false` (también `1`/`0`); otro valor da `400 validation`.
- `imageUrl` puede ser `null` (hoy siempre es un enlace al raw del tracker, I11).

## Públicas

| Método y ruta | Descripción |
|---|---|
| `GET /healthz` | `{ ok: true, version, catalogCommit, engineRev }`; `503 { error: { code: 'unavailable' } }` si la base de datos no responde en 3 s |
| `GET /login` | Página HTML autónoma de inicio de sesión (email, contraseña, código TOTP) |
| `POST /api/auth/login` | `{ email, password, totp? }` → `204` + cookie (si venía una sesión válida en la cookie, se cierra y se reemplaza). Límite 5 intentos / 15 min por IP (`429`), también los exitosos. Un código TOTP vale para un solo ingreso: repetirlo da `401 invalid_credentials`. |
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
| `GET /api/tokens` | `{ items: [{ id, name, kind: 'worker'|'mcp', scopes, prefix, lastUsedAt, expiresAt, revokedAt, createdAt, clients: [{ client, firstSeenAt }] }] }` (`clients`, Fase 43: los clientes vistos con el token, por el producto del `User-Agent`) |
| `POST /api/tokens` | `{ name, kind, scopes: string[] }` → `201 { id, token }` (el token completo se muestra una sola vez). Permisos: `worker:claim` (worker); `mcp:read`, `mcp:write` y `chat:relay` (MCP). `chat:relay` es el del puente del chat entre sesiones y va solo: combinado con otro, `400` |
| `DELETE /api/tokens/:id` | Revoca → `204` |
| `GET /api/mcp-audit?limit=50&tokenId=` | Fase 43: lo que Claude escribió por MCP, lo más nuevo primero: `{ items: [{ id, at, token: { id, name }, client, tool, title, args, ok, error, ms, undo: { kind: 'match_delete'|'collection_stock', label } | null, undoneAt }] }`. Los argumentos guardan los textos largos recortados (2.000 caracteres) |
| `POST /api/mcp-audit/:id/undo` | Fase 43: deshace una escritura que se puede deshacer (una partida borrada vuelve con el mismo id; una edición de la colección vuelve a la cantidad anterior si nadie la cambió después) → la fila con `undoneAt`; `409` si ya estaba deshecha, si la partida ya está, si su mazo ya no existe o si la colección cambió |

## Catálogo

| Método y ruta | Respuesta |
|---|---|
| `GET /api/catalog/status` | `{ trackerCommit, engineRev, syncedAt, counts: { cards, groups, stockUnits, expansions, packs }, lastSync: { id, status, startedAt, finishedAt, report } | null }` |
| `POST /api/catalog/sync` | `{ commit?, engineRev?, fromFixtures? }` → `202 { syncId }`; corre en segundo plano; estado en `status`; `409` si ya hay uno corriendo |
| `GET /api/expansions` | `{ items: Expansion[] }` con `packs: Pack[]` (sin `cardIds`) |
| `GET /api/cards?q=&lang=es|en|any&limit=20` | `{ items: CardSearchHit[] }` donde `CardSearchHit = { card: CardSummary, group: GroupSummary, score, matchedOn }`; con `?expansion=A1` y sin `q`: `{ items: CardSummary[], total }` |
| `GET /api/cards/batch?ids=A1-1,B1-36` | Fase 22: `{ items: CardEdition[] }` (hasta 80; los ids desconocidos se omiten) |
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

Remapeo (I12, Fase 21): si el commit nuevo mueve ediciones entre unidades de stock o cartas funcionales, o saca cartas, el stock, los ajustes, las cartas de los mazos, las cartas clave y las prohibidas de los eventos las siguen en la misma transacción. Lo que se tuvo que adivinar (fusión de unidades con cantidades distintas, una unidad o grupo que se separa, una carta de un mazo sin reemplazo) deja la sync en `needs_review`; cada caso es una línea en `warnings` y en `report.remap.notes` (`{ kind, review, text }`).

### Día de expansión (Fase 40)

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/catalog/latest` | `{ current: sha | null, latest: { sha, date, message } | null, comparison: { status: 'ahead'|'behind'|'identical'|'diverged', aheadBy, behindBy } | null, error: string | null }`: el último commit del `main` del tracker (API de GitHub, con `GITHUB_TOKEN` si está) contra el cargado; `latest: null` y `error` si GitHub no contesta |
| `POST /api/catalog/preview` | `{ commit?, engineRev?, fromFixtures? }` (sin `commit`: el último del tracker) → `{ trackerCommit, engineRev, current, counts, diff: DiffCounts | null, diffEmpty, expansionsAdded: [{ id, nameEn, nameEs, cards }], removed: [{ cardId, nameEs }] (las primeras 50), remap: { needsReview, empty, notes: [{ kind, review, text }] } | null, engine: { engineRev, plays, incomplete, unknown } (de las cartas nuevas, según lo que informó un worker), destructive, older, warnings }`: lo que haría la sincronización, sin escribir nada (unos segundos: baja los archivos del tracker); `409` si hay una sincronización en curso |

`POST /api/catalog/sync` (Fase 40, H-004): sin `commit` repite el **commit cargado** (antes volvía al fijado en la configuración); `confirm: true` hace falta para ir a un commit anterior al cargado (`409 confirm_required`) y para una actualización que saca cartas del catálogo o deja el remapeo en `needs_review` (si no, la fila de la sincronización queda `failed` diciendo por qué, sin escribir nada). La CLI `catalog:sync` no pide confirmación.

## Colección

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/collection/missions?expansion=&incomplete=` | Misiones de colección (Fase 8; datos del tracker al commit fijado, llegan con el sync del catálogo): `{ total, complete, expansions: [{ id, nameEs, missions }], items: [{ expansionId, expansionNameEs, name, reward, secret, complete, missingCopies, slots: [{ amount, have, nameEs, options: [{ cardId, rarity }] }] }] }`; `have` cuenta copias por unidad de stock entre las opciones (reimpresiones y otras artes valen; mellizas A1-1/A4b-1, una vez). Nombres y recompensas en inglés |
| `GET /api/collection/pack-luck` | Fase 17: `{ imports, intervals: [{ from, to, luck }] (las últimas 6, la más nueva primero), overall: { from, to, luck } | null }` con `from/to = { id, fileName, appliedAt }` y `luck = { gained, byRarity, rare: Tier, ex: Tier, packsEstimate }`, `Tier = { observed, expected, expectedShare, check: { verdict: 'too_few'|'normal'|'unlucky'|'lucky', lowerTail, upperTail, … } }`: lo que entró entre importaciones aplicadas contra las tasas de los sobres (aproximado) |
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
| `PATCH /api/decks/:id` | `Partial<DeckInput> & { builtInGame?, archived?, note? }` → `DeckDetail`; crea una revisión (`source: 'ui'`, con `note`) solo si cambian cartas o energías; registra en `changes` los cambios de `name`, `tags`, `notes`, `packPriority`, `tournamentArchetype`, `variantOf`, `builtInGame` y `archived`; `409 { code: 'built_in_game_limit', details: { built, max } }` cuando el mazo quedaría entre los armados no archivados y ya hay 25 (al marcarlo, al desarchivarlo si sigue marcado, o ambas cosas en el mismo PATCH: archivar **no** quita la marca `builtInGame`); `400` si `variantOfId` es el propio mazo |
| `DELETE /api/decks/:id` | Borra (solo si está archivado y sin partidas) → `204`; `409 deck_not_archived` si no lo está; `409 deck_has_matches` (`details: { matches }`) si tiene partidas registradas |
| `POST /api/decks/:id/duplicate` | `{ name? }` (default «<nombre> (copia)») → `201 DeckDetail` con `variantOfId` = el original, revisión 1 con `source: 'duplicate'` |
| `POST /api/decks/:id/revisions/:number/restore` | → `DeckDetail` (nueva revisión con `source: 'restore'` y nota «Restaurada la revisión N»; si la revisión pedida es idéntica a la actual no se crea nada); `404` si no existe |
| `GET /api/decks/:id/export?format=spanish|deckgym|limitless|json` | `text/plain` (o `application/json`), `Content-Disposition: inline; filename*=…`; `spanish` incluye el encabezado `### Nombre` y siempre `- Energía:`; deckgym siempre con `Energy:` (`400 energy_required` si el mazo no tiene energía elegida); sin `format`: `spanish` |
| `POST /api/decks/validate` | `{ text?, format?: 'spanish'|'spanish-file'|'limitless'|'json'|'auto', cards?, energies? }` → `{ draft, validation, completeness }` sin guardar; si el texto no parsea, `draft: null` y `validation.errors` trae los errores de parseo; con un archivo de varios mazos se valida el primero |
| `POST /api/decks/import` | `{ text, format?: 'auto'|'spanish'|'spanish-file'|'limitless'|'json' }` → `{ drafts: ImportedDeckDraft[] }` (vista previa; `spanish-file` acepta el archivo completo de 40 mazos con su tabla resumen) |
| `POST /api/decks/import/commit` | `{ decks: DeckInput[] }` → `201 { created: DeckSummary[] }` (todos o ninguno, en una transacción; revisión 1 con `source: 'import'`) |
| `GET /api/decks/by-card/:groupId` | `{ items: [{ id, name, count, builtInGame }] }` (mazos no archivados cuya revisión actual usa alguna edición del grupo; mismo contenido que `GroupDetail.decks`) |
| `GET /api/decks/:id/draw-odds?cards=&cards2=&turns=` | Fase 10: `DrawOdds`: la chance de tener cartas del mazo en la mano inicial y en cada turno propio (`cards`, `cards2`: ids de edición o de carta funcional separados por coma; sin `cards`, el atacante que más puntos da; `turns` 1–15, 6 por defecto). `400` si una carta no está en el mazo, si las dos son la misma o si el mazo no tiene Básicos |
| `POST /api/decks/draw-odds` | Fase 10: `{ deckSize? (20), basics, groups: [{ basic, other }] (1 o 2), turns? }` → `DrawOdds` con números a mano; `400` si no cierran |
| `GET /api/decks-today?sort=tournament|matches|lab` | Fase 15: `{ sort, meta: { era, kind: 'recent'|'era', days, lists } | null, items: [{ deck: { id, name }, archetype: { id, name, source } | null, mine: { record, rate } | null, tournament: { value, coverage, matches, rivals } | null, lab: { value, ci95, games, text, jobId, era } | null }], note }`: los mazos armados en el juego, tres números separados, ordenados por el elegido |
| `POST /api/decks/closest` | `{ deckId? | text?, format? | cards?, energies?, scope?: 'built'|'all', limit?: 1..10 }` (una de las tres fuentes) → `ClosestDecks`: los mazos guardados activos que necesitan menos cambios para convertirse en la lista; `built` (por defecto) compara solo con los armados en el juego, `all` con todos; el mazo de `deckId` se excluye. `400 invalid_deck_text` si el texto no tiene ningún mazo legible; `400 validation` sin fuente; `404` mazo inexistente |
| `GET /api/decks/random?builtInGame=&tag=&leastPlayed=&exclude=` | `{ deck: DeckSummary, games, candidates }`: un mazo activo al azar (CSPRNG); con `leastPlayed=true` solo entre los que tienen menos partidas; `exclude` deja afuera la elección anterior salvo que sea la única. `404 no_decks` si ningún mazo cumple el filtro |

Detección `auto`: texto que empieza con `{` → `json`; una tabla con fila `| # |` **o** dos o más encabezados `### N.` → `spanish-file`; un encabezado `### N.` o líneas `Pokémon:` / `Entrenadores:` / `Energía:` → `spanish`; lo demás → `limitless` (formato de líneas de Limitless/deckgym).

```ts
ImportedDeckDraft = {
  cards: [{ cardId, count, nameEs, nameEn, cardType: 'pokemon'|'trainer'|null }],  // = draft.cards con nombres del catálogo; [] si draft es null
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
DeckInput = { name, energies: SelectableEnergy[], cards: [{ cardId, count }], tags?: string[], notes?: string, variantOfId?: string | null, packPriority?: 0|1|2|3,
             tournamentArchetypeId?: string | null }   // arquetipo de Limitless para la columna «torneo»; null = sugerido
DeckSummary = { id, name, energies, tags, builtInGame, variantOfId: string | null, packPriority, tournamentArchetypeId, archivedAt, valid, errorCount, complete, missingCount, cardCount, createdAt, updatedAt, revisionNumber }
DeckDetail = DeckSummary & {
  cards: [{ card: CardSummary, count, group: GroupSummary, playable, missing }],   // una entrada por edición, en el orden de la lista
  validation: { ok, errors: Issue[], warnings: Issue[], infos: Issue[] },
  completeness: { complete, missing: [{ groupId, nameEs, need, have, cardIds }], missingCount },
  revisions: [{ number, createdAt, source: 'ui'|'import'|'mcp'|'duplicate'|'restore', note, cardCount, energies }],
  changes: [{ field, old, new, at, source }],
  notes: string,
  bestVersions: {                                     // mejores versiones que tengo de cada carta funcional
    changed: boolean,
    groups: [{ groupId, nameEs, need, current: [{ cardId, count }],
               recommended: [{ cardId, nameEs, rarity, holo, count }] }],   // solo las cartas que mejoran
    cards: [{ cardId, count }]                        // la lista entera reescrita (para PATCH { cards })
  }
}
Issue = { code, message, cardIds?: string[] }
ClosestDecks = {
  target: { deckId: string | null, name: string | null, cardCount },
  scope: 'built'|'all', candidates: number, builtInGameDecks: number,
  results: [{ deckId, name, builtInGame, swaps, keep,               // swaps = max(cartas a poner, cartas a sacar)
              toAdd: CardChange[], toRemove: CardChange[], otherEdition: CardChange[],
              energies: { from, to, change } }]                     // menos cambios primero; empate: misma energía, armado, nombre
}
CardChange = { groupId, nameEs, count, cardIds }
```

Mejor versión: entre las ediciones de la misma carta funcional que tengo (por fila del tracker), gana la de mayor rareza (◊ … ◊◊◊◊ < promo < ☆ < ☆☆ < ☆☆☆ < ✵ < ✵✵ < Corona) y, a igual rareza, la holográfica de los Deluxe (edición con fila propia cuya expansión trae también la reimpresión normal). En empates se queda la edición de la lista. Las copias que no tengo conservan la edición listada. Los ajustes manuales no se usan acá (son por carta funcional, no dicen qué edición).


```ts
// Fase 10: mano inicial de 5 con al menos un Básico y una carta por turno propio (también el primero); solo robo natural.
DrawOdds = { deck: { id, name } | null, deckSize, basics, groups: [{ cards: [{ groupId, nameEs }], copies, basicCopies }],
             rows: [{ turn (0 = mano inicial), cardsSeen, each: number[] (0–1, por carta), all: number | null (las dos) }],
             basicsInHand: [{ count (1–5), probability }], note }
```

## Partidas (Fase 2)

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/matches?deckId=&mode=&result=&opponent=&from=&to=&limit=50&offset=0` | `{ items: Match[], total }`, más reciente primero (`playedAt`, después `id`). `opponent` busca «contiene» sobre la clave del rival (sin mayúsculas, tildes ni signos: `blaz` encuentra «Mega-Blaziken ex»). `from` inclusivo, `to` exclusivo (ISO 8601). `limit` ≤ 200. `404` si `deckId` no existe |
| `POST /api/matches` | `MatchInput` → `201 Match`. Sin `playedAt`: hora del servidor y revisión actual del mazo; con `playedAt`: la revisión vigente en ese momento (la 1 si es anterior al mazo). Sin `mode`: el de la última partida registrada (la primera vez, `casual`). `404` mazo inexistente; `400 played_at_future` si la fecha está más de 10 min en el futuro; `400 validation` (rival > 80 caracteres, nota > 2000, resultado o modalidad inválidos). Se permite registrar con un mazo archivado |
| `GET /api/matches/suggestions` | `{ decks: [{ id, name, energies, builtInGame, lastPlayedAt, games }], lastDeckId, lastMode, opponents: [{ key, label, games, lastPlayedAt }], tournamentArchetypes: [{ name, lists }] }`: mazos no archivados en el orden del selector (jugados por fecha, después armados en el juego, después por nombre con orden numérico); `lastDeckId`/`lastMode` de la última partida **registrada** (`null` si su mazo está archivado); hasta 30 rivales del último año ordenados por conteo ponderado (vida media 14 días); `tournamentArchetypes`: arquetipos de la era vigente (Estándar) con 5 listas o más, para el autocompletado |
| `GET /api/matches/stats?deckId=&mode=&from=&to=` | `MatchStats` (solo partidas propias) |
| `GET /api/matches/:id` | `Match`; `404` |
| `PATCH /api/matches/:id` | `Partial<MatchInput>` (al menos un campo) → `Match`; si cambian `deckId` o `playedAt` se recalcula la revisión; `400` vacío; `404` |
| `DELETE /api/matches/:id` | `204`; `404` |
| `GET /api/decks/:id/comparison?mode=` | `DeckComparison`; `404` si el mazo no existe |
| `GET /api/matches/luck?deckId=&opponent=&mode=` | Fase 13: `{ deck, opponent | null, record, expected: { value, kind: 'matchup'|'archetype', label, games, perGame: { wins, losses } | null, era | null, from | null } | null, check: { games, actual, expected, lowerTail, upperTail, verdict: 'too_few'|'normal'|'unlucky'|'lucky' } | null, streak: { losses, probability, somewhere, games } | null, text }`: tu récord con el mazo (contra ese rival o en general) contra lo esperable según torneos y la racha de derrotas actual (3 o más). Fase 37 (H-009): por partida (los BO3 de torneo pasados a partidas sueltas), sin empates, solo tus partidas desde `from` (primer día de la era), con la incertidumbre del récord de torneo (`perGame`, beta-binomial) y «raro» de dos colas |
| `GET /api/rival-notes` | Fase 12: `{ items: RivalNote[] }` (por nombre) con `RivalNote = { key, label, archetypeId | null, text, createdAt, updatedAt }` |
| `GET /api/rival-notes/lookup?opponent=` | `{ note: RivalNote | null }`: la nota de un rival escrito de cualquier forma (misma clave que las estadísticas) |
| `PUT /api/rival-notes` | `{ opponent, text (≤ 5.000), archetypeId?, append? }` → `{ note }`: crea o reemplaza (`append` agrega un párrafo); texto vacío la borra (`{ note: null }`) |
| `DELETE /api/rival-notes/:key` | `204`; `404` si no existe |
| `GET /api/decks/:id/matchups?mode=` | Fase 9: `{ deck, archetype: { id, name, source: 'owner'|'guessed' } | null, era, tournamentsWithPairings, expected: Expected | null, rows: [{ rival: { id | null, name }, share | null, mine: { record, rate } | null, tournament: { record, rate } | null, luck: 'too_few'|'normal'|'unlucky'|'lucky' | null (Fase 13; Fase 37: con Holm entre los rivales del mazo) }], attribution }`: los 10 arquetipos más jugados y cada rival anotado con el mazo; tus partidas y el matchup de torneo del arquetipo del mazo, por separado |

```ts
MatchInput = { deckId: string, result: 'win'|'loss'|'tie', opponent?: string | null, wentFirst?: boolean | null,
               mode?: 'competitive'|'casual'|'beginner'|'event'|'friend', note?: string, playedAt?: string /* ISO */ }
Match = { id, deck: { id, name, archived }, deckRevision: number, result, opponent: string | null, wentFirst: boolean | null,
          mode, note, playedAt, source: 'ui'|'mcp', createdAt, updatedAt }
Row = { record: { wins, losses, ties }, rate: WinRate | null }
MatchStats = {
  filters: { deckId, mode, from, to },
  overall: Row,
  byDeck: (Row & { deck: { id, name, archived } })[],              // más jugados primero
  byOpponent: (Row & { key: string | null, label: string })[],      // key null = «Sin rival anotado», al final
  byWentFirst: (Row & { key: 'first'|'second'|'unknown', label })[], // siempre las tres filas
  byMode: (Row & { mode, label })[],                                 // solo modalidades jugadas
  byRevision: (Row & { revision: number | null })[]                  // solo con deckId; la más nueva primero
}
DeckComparison = { deck: { id, name, archived },
  columns: [{ source: 'matches'|'tournament'|'simulation', label, available, record: Record | null, rate: WinRate | null, note,
               rows?: [{ label, record, rate, note? }] }] }
  // siempre tres columnas en ese orden. Torneo (Fase 5): filas separadas «Lista exacta» (por carta funcional),
  // «Lista exacta por nombre» (si difiere) y «Arquetipo: …» (elegido en el mazo o sugerido por las listas más
  // parecidas, a 6 cambios o menos); el titular es la lista exacta si alguien la jugó, si no el arquetipo.
  // Simulación: available false hasta la Fase 6
```

El rival se guarda limpio (espacios colapsados); si no tiene letras ni números se guarda `null`. Las estadísticas agrupan por la clave y muestran la grafía más usada.

Fase 25: `GET /api/matches/stats` suma `turnOrder: { first, second, unknown, coverage, firstShare, secondShare, gap, z, p (Fase 37: prueba exacta de Fisher, la que decide), verdict: 'few'|'clear'|'maybe', text }` y cada fila de `GET /api/decks/:id/matchups` suma `turn: { first, second } | null`.

Fase 37 (H-011): los `WinRate` de torneo de arquetipos, listas, «qué puedo armar» y el meta semanal traen `designEffect` y su `ci95` cuenta las listas, no las partidas sueltas; `Expected` (esperado contra el meta) suma `ci95` y tira hacia la media de la era; las filas de matchups suman `perGame: { wins, losses } | null` y la vista del arquetipo `fieldPerGame`.

## Buscador (Fase 27)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/search?q=` | `{ q, cards: CardSearchHit[], decks: [{ id, name, archived }], archetypes: [{ id, name }], matches: [{ id, deck, opponent, result, playedAt, note }], notes: [{ key, label, archetypeId, text }], events: [{ id, name }] }` (hasta 6 de cada uno; con menos de 2 letras, todo vacío) |

## Partidas sin señal (Fase 28)

`POST /api/matches` acepta además `clientRef` (UUID que arma el celu; un segundo envío con el mismo devuelve la partida ya guardada, `201`) y `playedAgoMs` (entero, 0 a 30 días: cuánto hace que se jugó; `playedAt` gana si vienen los dos). `PATCH` no acepta ninguno de los dos.

## Analizar una partida contra el bot (Fase 29)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/play/:id/review?from=&to=&detail=summary\|full` | `{ id, status, deck, rival, bot, result, turns, coach: { decisions, agreement, hints, counts } \| null, lists: { you, bot }, review: { steps, turns: [{ turn, player, board, actions: [{ ply?, who, text, options?, coach?: { verdict, gap, rank, best? }, alternatives? }] }], keyMoments, omittedTurns } \| null, soFar, note }`; `review` es `null` mientras la partida no terminó (`soFar` trae lo que dijo el entrenador). MCP: `play_games`, `play_game_review`. |

## Ejercicios de cálculo (Fase 30)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/drills?kind=draw\|ko&deckId=&seed=` | `{ kind, seed, prompt, facts, choices, deckId, deck }` (sin la respuesta; sin `deckId`, un mazo elegido por la semilla) |
| `POST /api/drills/answer` `{ kind, deckId, seed, choice }` | `{ correct, answer, explanation, stats }` |
| `GET /api/drills/stats` | `{ today: { answered, correct }, streak, byKind: { draw, ko } }` (30 días) |

## Lista de intercambio (Fase 31)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/trades?rarities=◊◊◊◊,☆` | `{ gives: [{ cardId, groupId, nameEs, nameEn, rarity, owned, spare }], wants: [{ groupId, nameEs, nameEn, missing, decks, options: [{ cardId, rarity }] }], untradeable, byRarity: [{ rarity, wants, gives }], rarities, text, totals: { wants, gives, spare } }` |

## Resumen semanal (Fase 32)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/weekly?semana=YYYY-MM-DD` | `{ week: { start, from, to, label, previous, next, current }, matches: { overall, previousWeek, byDeck, bestRival, worstRival }, bot: { games, wins, losses, ties, coachGames, coachAgreement }, practice: { situationsTried, situationsSolved, drillsAnswered, drillsCorrect }, work: { simulations, lab }, imports, meta: { rising, falling } \| null, headline, quiet }` (por defecto la última semana completa) |

Notificaciones: nuevo tipo `weekly` en `GET/PUT /api/notifications/preferences`.

## Partidas contra el bot al instante (Fase 33)

`GET /api/play/:id/events`: eventos del servidor (`text/event-stream`); cada mensaje es la partida como en `GET /api/play/:id`, cada vez que cambia; un evento `ping` cada 15 s. Termina cuando la partida está terminada con repetición, fallida o abandonada.

## Prueba del backup (Fase 35)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/backup/drill` | `{ drill: { at, ok, blobId, sizeBytes, counts, differences, ms, error } \| null }` |
| `POST /api/backup/drill` | corre la prueba ahora (hace una copia nueva, la restaura en una transacción, compara y la deshace): `{ drill }` |

## Arreglos de la Fase 36

- `PUT /api/worker/chunks/:id/heartbeat` responde además `lost`: el chunk ya no es de ese worker (volvió a la cola, falló u otro lo tiene) y no se renueva. `PUT …/failure` de otro worker no cambia nada.
- Mazos: `energies` admite hasta 3 (error de validación `energy_too_many`).
- El alcance de Torneos (`scope`) trae `newSetTournaments`: torneos que quedaron afuera de la era por un set que falta en la tabla de eras.
- `GET /api/alerts`: códigos nuevos `era_missing_set` y `worker_idle`.
- `GET /api/collection/pack-luck`: cada intervalo trae `ambiguous` (copias de reimpresiones que no cuentan).
- Las respuestas van comprimidas con gzip cuando el cliente lo acepta, salvo los eventos del servidor y `/api/mcp`.

## Sobres (Fase 4)

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/packs` | `{ items: [{ id, expansionId, expansionNameEs, name, nameEs, available, limited, limitedUntil, cardsPerPack, cardCount, containsShinies, containsBabies, inTrackerOverview }] }`: los 29 sobres que se abren (expansiones con estructura de sobre; sin los «everypack» de los sets con varios sobres ni las promos). El Deluxe ex (A4b) empieza apagado; el Deluxe Mega (B4b) empieza «por tiempo limitado» con último día 28/10/2026 (`limitedUntil`, YYYY-MM-DD, hora de Buenos Aires) |
| `PATCH /api/packs/:expansionId/:name` | `{ available?, limited?, limitedUntil?: YYYY-MM-DD | null }` (al menos uno) → el sobre; `404` si no es un sobre abrible. Los interruptores son tuyos: el sync del catálogo no los pisa y viajan en el backup. Pasado `limitedUntil`, el sobre deja de contar como disponible |
| `POST /api/packs/recommend` | `{ model?: 'corrected'|'tracker', alpha?: 0..1, collection?: { rarities: Rarity[], copies: 1..5 } | null, onlyAvailable?, limitedBoost?: 1..5, deckTarget?: 'saved'|'tournament' }` → `Recommendation`. Lo omitido sale de `app_settings` (`packModel`, `alpha`, `rarityFilter`, `limitedBoost`, `packDeckTarget`; por defecto corregido, 0,7, todas las rarezas con 1 copia, ×3 (D-007) y `saved`). Objetivo mazos: los mazos activos con `packPriority` 1–3, cada uno con su lista guardada o, con `deckTarget: 'tournament'`, con su versión de torneo (ver Torneos; un mazo sin versión de torneo usa la suya). `Recommendation` trae `deckTarget` y, por mazo objetivo, `target` y `list: { key, lists } | null` |
| | Fase 14: cada mazo trae `plan: { packs: { mean, p50, p80 }, days: { p50, p80 }, groups: [PackRef & { copies, cards, limited, endsBeforeDone }], redeemable } | null` (cada carta de su mejor sobre, uno después del otro; mediana y percentil 80 de una simulación del plan entero; días al ritmo de los ajustes `packsPerDay` (2) y `hourglasses` (0, 12 por sobre)), y la respuesta `planner: { packsPerDay, hourglasses }` |
| `GET /api/rarity-rules` | `{ items: [{ rarity, points, verified, tradeable }] }` para todas las rarezas (tracker + ✵ 1000 y ✵✵ 1350 sin verificar; P sin costo) |
| `PATCH /api/rarity-rules/:rarity` | `{ points?, verified?, tradeable? }` → la regla; `404` rareza desconocida |

```ts
Recommendation = {
  model, alpha, collection, onlyAvailable, limitedBoost,
  today,                                 // YYYY-MM-DD en Buenos Aires: días que quedan y sobres limitados vencidos
  goals: { decks: [{ id, name, priority }] },
  rows: [{ packId, nameEs, expansionId, expansionNameEs, available, cardsPerPack,
           wanted,                       // ediciones del sobre que cuentan para algún objetivo
           probability,                  // % de al menos una buscada por sobre
           expected,                     // cartas buscadas esperadas por sobre
           expectedValue,                // puntaje, 1 = mejor sobre a la venta: α·(valor mazos / mejor) + (1−α)·(valor colección / mejor);
                                         // un sobre que no está a la venta puede pasar de 1
           packsFor50, packsFor90,       // ⌈ln(1−q)/ln(1−p)⌉; null si p = 0
           decks: { probability, expected } | null, collection: { probability, expected } | null,
           otherModel: { model, probability, reasons: ('reprints'|'babies')[] },
           limited: { until, daysLeft,  // daysLeft 0 = último día, < 0 = terminó (y available = false)
                      exclusive: [{ cardId, nameEs, rarity, holo, goal: 'decks'|'collection' }] } | null }],
                                         // a la venta primero, después por puntaje
  missing: [{ groupId, nameEs, missing, weight, decks: [{ deckId, name, priority, need }],
              cheapest: { cardId, rarity, points, verified, tradeable } | null,
              tradeable,                                         // alguna versión se puede intercambiar
              bestPack: { packId, nameEs, expansionId, expansionNameEs, probability, packsPerCopy, limited } | null,
              afterLimited: { packId, nameEs, expansionId, expansionNameEs, probability, packsPerCopy } | null,
              pointsInPacks, redeem: { cardId, rarity, points, verified, tradeable, saved, copies } | null,
              advice: 'redeem'|'buy'|'open'|'trade'|null }],   // redeem: los puntos guardados de su expansión (ajuste packPoints) ya la pagan
              // «buy» si los puntos cuestan menos sobres que sacarla; «trade» si ningún sobre a la venta la da ni sus
              // puntos se pueden ganar; cheapest solo mira expansiones con algún sobre a la venta
  decks: [{ deckId, name, priority, missingCopies, notInPacks: string[],
            bestPacks: [{ packId, nameEs, expansionId, expansionNameEs, covered, limited, expectedPacks,
                          method: 'exact'|'simulation', ci95: [lo, hi] | null }] }],   // más copias cubiertas primero
  collectionOutOfPacks: { versions, tradeable } | null,   // versiones buscadas que ningún sobre a la venta da
  assumptions: string[]
}
```

Modelo: port de `stats.ts` del tracker @ `3ab58f1` (tablas por posición, mezcla de sobre normal, raro y de 6 cartas). «tracker» reproduce sus dos errores para coincidir con su web; «corrected» (por defecto) cuenta las reimpresiones de otra expansión y no saca las bebés del denominador en sets sin sobre de bebés. Cada fila dice cuánto daría el otro modelo y por qué.

Versiones: el objetivo mazos busca cartas funcionales (cualquier versión sirve); el objetivo colección busca versiones, identificadas por el `internal_id` del tracker. Dos números con el mismo `internal_id` son la misma versión y comparten copias (A1-1 = A4b-1, B1a-1 = B4b-1); un arte u holo nuevo es otra versión de la misma carta funcional (B4b-237, Bulbasaur holo). Sobres por tiempo limitado: lo que solo ellos dan frente a los sobres a la venta que quedan (carta funcional para mazos, versión para colección) pesa `limitedBoost` veces más hasta su último día (DECISIONES 4.9).

## Notificaciones (Fase 18)

Web Push con claves VAPID del entorno (sin ellas, `enabled: false` y nada se envía).

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/notifications` | `{ enabled, publicKey | null, devices: [{ id, userAgent, createdAt, lastSuccessAt, endpoint }], preferences: { liveGame, simulations, lab, alerts } }` |
| `POST /api/notifications/subscribe` | La suscripción del navegador (`{ endpoint, keys: { p256dh, auth }, userAgent? }`) → `204` |
| `DELETE /api/notifications/subscribe` | `{ endpoint }` → `204` |
| `PUT /api/notifications/preferences` | `{ liveGame?, simulations?, lab?, alerts? }` → las preferencias |
| `POST /api/notifications/test` | Una notificación de prueba a cada dispositivo → `{ sent }` |

El servidor revisa cada 15 s qué avisar (partida que espera tu jugada si no la tenés abierta, simulaciones y búsquedas que terminaron, avisos nuevos). El payload es `{ title, body, url, tag }`; tocar la notificación abre `url`.

## Eventos (Fase 16)

Reglas de mazo de un evento del juego, cargadas a mano. `EventRules = { types?: EnergyType[], minOfType?: { type, count }, noEx?: boolean, rarities?: Rarity[], expansions?: string[], banned?: groupId[] }`.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/events` | `{ items: Event[] }` con `Event = { id, name, startsOn | null, endsOn | null, rules, rulesEs: string[], notes, createdAt, updatedAt }` |
| `POST /api/events` | `{ name, startsOn?, endsOn?, rules, notes? }` → `201 Event`; `400` si una carta prohibida o una expansión no existe |
| `GET /api/events/:id` | `Event & { decks: [{ id, name, builtInGame, ok, problems: string[] }] (los que cumplen primero), lists: [{ key, archetype, lists, rate, missingCopies, pokemon }] (listas exactas de la era que cumplen con cualquier edición, las armables primero, 20), era }` |
| `PATCH /api/events/:id` | Cualquier campo de `POST` → `Event` |
| `DELETE /api/events/:id` | `204` |

`POST /api/lab/explore` acepta `eventId`: la lista de partida tiene que cumplir (`422 event_rules`), solo entran cartas que el evento permite y cada variante cumple las cuentas; el detalle de la búsqueda trae `explore.event: { id, name, rules }`.

## Torneos (Fase 5)

Datos de Limitless (play.limitlesstcg.com) por **era** y **formato**. La era de un torneo es el último set que abre era lanzado hasta su fecha (UTC; los Deluxe no abren era), según la tabla editable `set_releases`. Formato = `format ?? STANDARD`; `NOEX` aparte; `CUSTOM` y formatos desconocidos, fuera. Cuentan los torneos con `players ≥ minPlayers` (setting, 12 por defecto), con listas y sin bans ni reglas especiales. `?era=` (código, p. ej. `B4a`; por defecto la vigente) y `?format=STANDARD|NOEX` valen en todas las lecturas. Una lista es una fila de standings con lista; el récord es `W/(W+L+T)` con Wilson 95 % sobre partidas, «orientativo» con menos de 30 listas, y la media de la era al lado.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/tournaments/status` | `{ currentEra: Era | null, eras: Era[] (más nueva primero), newEra: { lastRelease, releaseDate, days, likely } | null, minPlayers, sync: { enabled, running, progress (con `pairingsDone`, `pairingsPending`), lastRun, callsInWindow, counts: { listed, complete, incomplete, excluded, failed }, pairings: { fetched, missing } (Fase 9: torneos completos con y sin rondas), newestTournament } }`; `likely` = más de 35 días desde el último lanzamiento de la tabla |
| `POST /api/tournaments/sync` | `{ backfillDays?: 1..180 }` → `202 { started }` (`false` si ya hay una corrida). Corre en segundo plano |
| `GET /api/tournaments/archetypes` | `{ scope: Scope, rows: [{ archetype: { id | null, name, icons }, lists, record, rate, share }] }`, más listas primero (`id: null` = sin arquetipo) |
| `GET /api/tournaments/archetypes/:id?card=&minCount=1|2` | `{ scope, archetype: Row, merged: string[], lists: ListRow[] (20 más jugadas), cards: [{ groupId, nameEs, lists, share, byCopies: [0, ×1, ×2], averageCopies }], withWithout: { card, minCount, with: Row, without: Row } | null, matchups: ArchetypeMatchups }`; `card` = id de carta funcional o de edición; `:id` = `none` para las listas sin arquetipo; `404` sin listas |
| `GET /api/tournaments/archetypes/:id/cards` | Fase 44: `{ scope, archetype, lists, resamples, core: [{ groupId, nameEs, lists, share, averageCopies, byCopies }], coreSlots, freeSlots, techs: [{ groupId, nameEs, lists, share, averageCopies, with: Row, without: Row, difference }], copies: [{ groupId, nameEs, lists, share, one: Row, two: Row, difference }], conversion: TopConversion | null, note }`; `difference` = `{ value (puntos), ci95, p, clear, orientative, text }` o `null` con menos de 5 listas (o sin partidas) de un lado; `conversion` = `{ top, minPlayers, minCoverage, tournaments, lists, topLists, rate, ci95, expected, baseline, ratio, ratioCi95, excluded: { tournaments, lists }, orientative, text }`, top 8 en torneos de 32 jugadores o más con el 90 % de las listas publicadas y todo el top, contra lo esperado por el resto de las listas publicadas de cada torneo (`ratio`: Mantel–Haenszel); `rate`, `ci95` y `baseline` son `null` cuando todos sus torneos quedaron afuera; `404` sin listas |
| `GET /api/tournaments/trends?era=&format=&days=&minLists=` | Fase 11: `{ scope, days, now: Window, before: Window, archetypes: [{ archetype, now: { lists, share }, before: { lists, share }, delta (puntos), clear, record, rate (de esta semana), isNew }] (por `delta`, de mayor a menor), cards: [{ groupId, nameEs, now, before, delta, p, clear }], attribution }` con `Window = { from, to (exclusivo), tournaments, lists }`; las ventanas de `days` (3–30, 7) terminan el día después del torneo más nuevo; `clear` = prueba de dos proporciones agrupada por torneo con Benjamini–Hochberg al 5 % entre arquetipos y cartas (Fase 37; `p` en cada fila); `minLists` (5) en alguna ventana |
| `GET /api/tournaments/matchups?era=&format=&top=` | Fase 9: `{ scope, coverage: { tournaments, tournamentsWithPairings, matches, skipped: { byes, doubleLosses, noArchetype } }, archetypes: [{ archetype, share, lists, field: { record, rate }, expected: Expected | null }] (los `top` más jugados, 2–30, 12 por defecto), cells: [{ a, b, record, rate }] (cada par que se enfrentó, en los dos sentidos), attribution }` |
| `PUT /api/tournaments/archetypes/:id/alias` | `{ canonicalId: string | null }`: muestra `:id` como parte de `canonicalId` (sigue cadenas); `null` lo separa |
| `GET /api/tournaments/lists?kind=group|name&archetype=&minLists=&limit=100` | `{ scope, rows: ListRow[], total }` |
| `GET /api/tournaments/lists/:key?kind=` | `{ scope, list: ListRow & { missing, missingCopies }, substitutes: [{ groupId, nameEs, need, have, options: [{ groupId, cardId, nameEs, reason: 'same_name'|'replaces'|'archetype', reasonEs, lists, of, have }] }] (Fase 8: por cada carta que falta, hasta 3 reemplazos que tenés), energies: string[], text (portapapeles de Limitless, también deckgym), entries: [{ tournamentId, tournamentName, date, playerName, placing, record }] }`; `400` clave inválida, `404` |
| `GET /api/tournaments/buildable?limit=100` | `{ scope, buildable: (ListRow & { missing: [], missingCopies: 0 })[], near: (ListRow & { missing: [{ groupId, nameEs, need, have }], missingCopies: 1|2 })[] }` |
| `GET /api/tournaments/decks/versions` | `{ scope, decks: DeckVersion[] }` de los mazos activos (sin `alternatives`) |
| `GET /api/tournaments/decks/:id/version` | `{ scope } & DeckVersion` con hasta 3 `alternatives`; `404` si el mazo no existe |
| `GET /api/tournaments/unlock?limit=50` | `{ scope, cards: [{ groupId, nameEs, have, copies, lists, listsWithOneCopy, entries, record, rate, unlocked: ListRow[] (5) }] }`: listas a las que les falta solo esa carta, más listas primero |
| `GET /api/tournaments/events` | `{ scope, rows: [{ id, name, date, players, lists, organizerName, conflict }] }` |
| `GET /api/tournaments/unknown-cards` | `{ scope, cards: [{ ref, set, number, name, occurrences }] }`: cartas de las listas que el catálogo no conoce (se re-mapean solas al sincronizarlo) |
| `GET /api/tournaments/sets` · `PUT /api/tournaments/sets/:code` | `{ items: [{ code, nameEn, nameEs, releaseDate, opensEra }] }` · `{ nameEn, releaseDate: YYYY-MM-DD, opensEra }` → el set (alta o cambio) |
| `GET /api/tournaments/sets/proposals` | Fase 40 (H-006): `{ items: [{ code, nameEn, nameEs, releaseDate, opensEra, tournaments, firstTournament: { id, name, date }, inCatalog }] }`: las filas que le faltan a la tabla de eras, propuestas desde los torneos que ya juegan ese set (fecha del primero; abre era salvo que el catálogo lo llame Deluxe); se agregan con `PUT /api/tournaments/sets/:code` |

```ts
Scope = { era: { code, nameEs, from, to | null, current }, format, minPlayers, tournaments, lists, games,
          mean: Row,                                   // media de la era: ΣW/Σ(W+L+T), la base (no 50 %)
          conflicts: [{ tournamentId, name, date, set }],  // listas con un set posterior a la fecha (¿pre-release? ¿falta un set?)
          unknownCards, attribution }
Row = { lists, record: { wins, losses, ties }, rate: WinRate | null, share }   // share: % de las listas de la era
ListRow = Row & { key (14 hex), kind: 'group'|'name', archetype, otherKey,
                  cards: [{ groupId | null, cardId | null, nameEs, nameEn, set, number, count, cardType }] }
```

```ts
DeckVersion = { deckId, deckName,
                archetype: { id, name, icons, source: 'owner'|'guessed', swaps | null } | null,   // elegido en el mazo o sugerido (≤ 6 cambios)
                version: { list: ListRow, swaps, add: [{ groupId, nameEs, count }], remove: [...],
                           missing: [{ groupId, nameEs, need, have }], missingCopies, alternatives: ListRow[] } | null }
```

Versión de torneo de un mazo: entre las listas exactas (por carta funcional) de su arquetipo jugadas 5 veces o más en la era, la de mejor cota inferior del intervalo; si ninguna se repite tanto, la más jugada. Lista exacta: las mismas 20 cartas sin mirar la edición, sin energías. `kind=group` (por defecto) agrupa por carta funcional y distingue homónimas con otro texto; `kind=name` es la del brief (nombre inglés de Limitless). Sync: backfill de 60 días en la primera corrida y una incremental cada 6 h (`LIMITLESS_SYNC`, encendido solo en producción), tope propio de 40 llamadas cada 5 min, 429 → pausa `max(Retry-After, t, 60 s)`, 5xx → reintentos a 1, 2, 4, 8 y 16 min.


```ts
// Fase 9: matchups entre arquetipos, de las rondas de Limitless (una partida = un BO1 o un BO3 entero).
ArchetypeMatchups = { rows: [{ rival: ArchetypeRef, share (0–100), record, rate }] (rivales que enfrentó, los más jugados primero),
                      expected: Expected | null, tournamentsWithPairings }
Expected = { value (0–100): Σ cuota × matchup, cada matchup acercado al récord del arquetipo contra todos como si tuviera 10 partidas más (y ese récord, a 50 % con 20 partidas, Fase 15),
             coverage: cuota del meta con 10 partidas o más, matches, rivals }
```

## Simulación (Fase 6)

Partidas entre mazos con deckgym-core (`engine-cli`, `engine/`) que juega el worker de la PC (`apps/worker`). Un **trabajo** (`matrix`, `compare`, `optimize` o `explore`, este último solo desde el Laboratorio) congela sus mazos en **fotos** (`deck_snapshots`) y se parte en **chunks** de hasta 1000 partidas, uno o más por cruce; cada chunk lleva su semilla (`baseSeed + idx`). Resultados: victorias, derrotas y empates aparte, `WinRate` con `source: 'simulation'` (victorias / partidas, Wilson 95 %, «orientativo» con menos de 30). Nunca se combinan con torneos ni partidas propias.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/simulations?archived=` | `{ items: JobSummary[], counts: { archived, cancelled, done } }`: las 50 más recientes sin archivar (`done` = terminadas sin archivar); con `archived=true`, solo las archivadas (200) |
| `GET /api/simulations/analysis` | Análisis de lectura de todos los trabajos (archivados incluidos), con `source: 'simulation'`, `summary`, `options`, `matrices`, `rankings`, `matrix`, `comparison`, `agreement`, `games`, `patterns`, `findings` y `calibrationJobId`. Filtros opcionales `bot`, `era`, `expansion`; selección `matrix`, `left`, `right` (ids positivos de matrices dentro del filtro; 400 si no pertenecen). |
| `POST /api/simulations/cleanup` | `{ action: 'delete_cancelled' | 'archive_done' }` → `{ count }`: borra todas las canceladas o archiva todas las terminadas |
| `POST /api/simulations/:id/archive` · `/unarchive` | `JobSummary`; archivada = fuera de la lista, sus resultados siguen contando (comparativa, consistencia, Laboratorio); `400 job_running` si está en cola o corriendo |
| `GET /api/simulations/engine` | `{ engineRev, cards, incomplete, source: 'worker'|'fallback'|'none', upstream: { checkedAt, pinned, aheadBy, latest: { sha, date, message } | null, compareUrl } | null (commits de deckgym-core `main` desde el motor fijado; producción, cada 12 h, `ENGINE_UPSTREAM_CHECK`), workers: [{ id, name, engineRev, cliVersion, cores, version, lastSeenAt, online, current: { jobId, chunkId, gamesDone, games } | null }], bots: [{ code, label }] }`; `fallback` = la lista de la Fase 0 hasta que un worker sube `engine-cli status`; `online` = habló en los últimos 2 min |
| `POST /api/simulations/preview` | `JobInput` → `{ sideA: Snapshot[], sideB: Snapshot[], pairings, totalGames, estimatedSeconds, engineRev }` (sin `id` en las fotos; no guarda nada) |
| `POST /api/simulations` | `JobInput` → `201 JobSummary`; `422 not_simulable` si algún mazo no es simulable y no se pidió `skipNotSimulable`; `400 validation` (sin cruces, optimizar sin cartas o con más de 200 combinaciones) |
| `GET /api/simulations/:id` | `JobDetail` |
| `GET /api/simulations/:id/events` | SSE: un `JobSummary` cada 2 s mientras el trabajo está en cola o corriendo; el último lleva el estado final |
| `POST /api/simulations/:id/cancel` | `JobSummary` (los chunks pendientes pasan a cancelados; el worker corta el motor en el próximo latido) |
| `POST /api/simulations/:id/priority` | `{ priority: entero de 0 a 2147483647 }` → `JobSummary` con la prioridad nueva; solo en cola o corriendo (`400 job_finished` en cualquier estado terminado). La app alterna 1 («Adelantar») y 0 («Volver a normal»); no interrumpe chunks ya reclamados. |
| `DELETE /api/simulations/:id` | `204`; borra chunks y repeticiones (las fotos quedan) |
| `GET /api/simulations/replays/:id/raw` | El JSON de la repetición tal cual lo escribió el motor (para el viewer de deckgym: `/viewer/index.html?url=/api/simulations/replays/:id/raw`, D-014) |
| `GET /api/simulations/replays/:id` | `{ replay (JSON de deckgym tal cual), names: { [engineId]: nombre en español }, cardIds: { [engineId]: cardId } (Fase 22), game: { jobId, jobLabel, engineRev, gameIndex, seed, winner: 'a'|'b'|'tie', decks: [etiqueta A, etiqueta B], playersEs } }` |

```ts
Source = { deckId, energies? } | { listKey (14 hex), era?, format?: 'STANDARD'|'NOEX', kind?: 'group'|'name', energies? }
JobInput = { kind: 'matrix'|'compare'|'optimize', label?, sideA: Source[1..60], sideB: Source[0..60],
             gamesPerPair: 1..20000, players: [bot, bot], seed?: 0..2^52, bothOrders?, replaySample?: 0..5 (2),
             cores?: hilos por chunk (si no, los del worker), skipNotSimulable?,
             optimize?: { remove: [{ cardId, count: 1|2 }], candidates: cardId[] } }   // optimize: sideA = 1 mazo, sideB = rivales
Snapshot = { id, key, label, sourceType: 'deck_revision'|'tournament_list'|'text'|'lab', sourceId, deckId, energies,
             simulable, problems: [{ kind: 'unknown_card'|'not_implemented'|'energy_required'|'size'|'no_basic'|'too_many_copies', message, … }],
             remapped: [{ cardId, playedAs }],   // reimpresiones B4b jugadas como otra edición
             deckgymText }
JobSummary = { id, kind, status: 'queued'|'running'|'done'|'failed'|'cancelled', label, players, playersEs, gamesPerPair,
               baseSeed (string), engineRev, replaySample, createdAt, startedAt, finishedAt, error, lab: 'test'|'explore'|null,
               archived: boolean, priority: number,   // 0 = normal; más alto va primero al reclamar
               progress: { totalGames, gamesDone, chunks: { total, done, running, failed }, etaSeconds | null } }
JobDetail = JobSummary & { snapshots: Snapshot[], sideA: id[], sideB: id[],
               rows: [{ snapshot, total: Record, rate, cells: [{ rival, record | null, rate | null }] }],   // matriz y comparar
               optimize: [{ cards: [{ engineId, cardId, nameEs }], record, rate, perEnemy: [{ snapshot, record, rate }] }] | null,
               replays: [{ id, chunkId, a, b, gameIndex, seed, winner, sizeBytes }],
               chunks: [{ id, idx, a, b, games, gamesDone, status, seed, attempt, error }] }
```

Bots (`players`): `r` al azar, `w` al azar ponderado, `aa` adjunta y ataca, `et` termina el turno, `er` evoluciona primero, `v` función de valor, `m` MCTS (100 iteraciones), `e1`…`e9` expectiminimax de esa profundidad (`e3` tarda ~2× `e2`). La matriz por defecto: `e2` contra `e2`, 200 partidas por cruce.

Análisis (`T-019`, DECISIONES 52): `summary` cuenta partidas de chunks terminados una sola vez y todos los tipos de trabajo; los rankings usan matrices con el mismo bot en ambos lados. Cada matriz conserva su bot, motor y era. `expansion` filtra sets de las cartas de las fotos (subtotales solapados), y `era` solo metadatos guardados; no se inventa una era para las corridas antiguas. Comparación sobre listas exactas y rivales comunes, con pesos iguales, diferencias en puntos e IC del laboratorio y Spearman/bootstrap de 1.000 remuestras de listas. `games.coverage` indica cuántas partidas tienen `perGame`: empezar y el histograma solo usan esa muestra; la duración agregada puede tener media y n sin IC. `patterns` tiene cruces dominantes, hasta 50 ciclos y `cyclesTotal`; los hallazgos son exploratorios con IC puntuales. La caché se invalida por versión de resultados y metadatos. `simulations_analysis` acepta los mismos argumentos y devuelve exactamente el mismo objeto; `calibrationJobId` referencia el reporte independiente de `/api/calibration/:id`, que la pantalla reutiliza lado a lado.

### Worker

`Authorization: Bearer tcg_wk_…` (token de tipo worker, scope `worker:claim`); la sesión no sirve acá.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/worker/ping` | `{ ok: true, token: { name, kind } }` |
| `POST /api/worker/claim` | `{ workerId, name, engineRev (40 hex), cliVersion?, cores, version?, allowSlowBots? }` → long-poll de hasta 25 s; entre trabajos elegibles, primero clase protegida D-024 (laboratorio/explore/consistency), luego prioridad descendente, chunks pendientes, antigüedad, id e índice → `{ chunk: { chunkId, jobId, kind, idx, games, firstGame, seed, players, threads, replaySample, leaseUntil, deckA, deckB, optimize } \| null, requiredEngineRev, retryAfterSeconds }`; con `chunk: null` y `requiredEngineRev`, la cola espera otro motor. D-025: `allowSlowBots: false` excluye trabajos con `m`, `e3`…`e9` o `f3`…`f9` antes del lease, sin alterar chunks/semillas; omitido vale true (workers anteriores); Android envía false por defecto |
| `PUT /api/worker/chunks/:id/heartbeat` | `{ workerId, gamesDone, total? }` → `{ leaseUntil | null, cancelled }` (renueva el lease de 3 min) |
| `PUT /api/worker/chunks/:id/result` | `{ workerId, engineRev, winsA, winsB, ties, games, turns?, durationMs, extra? }` → `{ accepted }` (idempotente: `false` si ya estaba) |
| `PUT /api/worker/chunks/:id/failure` | `{ workerId, error }` → `{ status }` (`queued` o, a la tercera, `failed`) |
| `PUT /api/worker/chunks/:id/replays/:gameId?index=&seed=&winner=` | Cuerpo: el JSON de la repetición en gzip (`application/gzip`, hasta 8 MB) → `{ id }` |
| `PUT /api/worker/engine-status` | `{ engineRev, cards: [{ id, name, status, complete }] }` (salida de `engine-cli status`) → `{ cards, incomplete }` |

### Consistencia (Fase 8)

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `POST /api/simulations/consistency` | `{ deckId, keyCards?: cardId[], games? (1000, 10–10.000), bot? (e2), seed? }` → `201 JobSummary` (`kind: 'consistency'`, un chunk, `players: [bot, 'et']`); sin `keyCards`, el Pokémon del mazo que más puntos da (todas sus ediciones); `422 not_simulable`, `400` si las cartas clave no están en el mazo |
| `POST /api/lab/consistency` | `{ deckId, keyCards?, games? (1000), bot? (e2, no `et`), seed?, era?, format?, size? (15) }` → `201 JobSummary`: **contra el meta** (D-019): las partidas se reparten entre los rivales del banco del Laboratorio según su peso (mayor resto) y se juegan de verdad, los dos mazos con `bot` (`players: [bot, bot]`); `422 empty_bank` |
| `GET /api/simulations/consistency/deck/:deckId` | `{ result: Medida | null, meta: Medida | null }` con `Medida = { job: JobDetail, consistency: Consistency }`: la última medición terminada del mazo (cualquier revisión) contra un rival pasivo y contra el meta |

```ts
Consistency = { mode: 'goldfish'|'meta', era | null, rivals: [{ label, share, games }],   // meta: el banco y las partidas contra cada uno
                deckId, deck, keyCards: [{ cardId, nameEs }], bot, botEs, maxTurn, games: { first, second, all },
                ready: { first: Curve, second: Curve, all: Curve },    // atacante clave en juego con energía para un ataque
                attack: { first: Curve, second: Curve, all: Curve } }  // activo y con un ataque posible
Curve = [{ turn (turno propio 1…), ready, games, value (0–100), ci95 }]   // acumulada: P(listo en el turno propio ≤ N), Wilson 95 %
```

`JobDetail.consistency` trae lo mismo en el detalle de la simulación. Partidas «goldfish»: el mazo lo juega el bot sin elegir atacar y el rival es el mismo mazo con `et` (solo termina el turno), así la partida dura y se mide cómo se arma la lista. El worker solo recibe estos chunks desde la versión 0.2.0, y los de «contra el meta» desde la 0.2.1 (el claim trae `consistency.rivals: [{ deck, games }]`; en esas partidas el mazo ataca, y una partida que termina antes del atacante listo cuenta como «nunca»).

## Jugar contra un bot (Fase 8)

La partida corre en el worker de la PC (`engine-cli play`); la app muestra cada decisión y manda tu elección. Está determinada por su semilla y tus elecciones: si el worker se reinicia, otro la toma (el lease vence a los 3 min) y la reconstruye mandando las elecciones ya hechas.

T-015: con `runner: 'browser'` la juega la página abierta de la partida con el motor en WebAssembly (`/engine/`, `engine/wasm`), sin la PC; ningún worker la toma ni la página toma partidas de un worker, porque la misma semilla no da la misma partida en los dos (R-003). Empieza en `running` (nunca `queued`) y termina en el navegador.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/play` | `{ items: [{ id, status, runner, coach, botEs, human, rival, winner, turns, createdAt, finishedAt }] }` (30 más recientes; las que llevan una semana sin movimiento pasan a `abandoned`) |
| `POST /api/play` | `{ human: Source, rival: Source, bot? (e2), seed?, coach? (false), runner? ('worker'), engineRev? }` → `201 LiveGame`; `400 not_simulable` si un mazo no se puede jugar. `coach`: modo entrenador (Fase 20). `runner: 'browser'` (T-015) pide `engineRev` = el motor del servidor (`409 engine_mismatch`) |
| `GET /api/play/:id` | `LiveGame` |
| `POST /api/play/:id/choice` | `{ ply, i }` → `LiveGame`; `409 not_your_turn` / `stale_decision`, `400` opción inexistente |
| `GET /api/play/recent-lists?days=7&top=8&era=&format=` | Fase 23: `{ era, format, days, from, to, items: [{ listKey, archetypeId, archetypeName, tournamentId, tournamentName, date, players, playerName, placing, record, pilots, energies, playable, problem }], attribution }` (hasta 80) |
| `POST /api/play/:id/undo` | Fase 22: vuelve a tu decisión anterior (en tu turno o con la partida terminada) → `LiveGame` en `queued` con una elección menos (en `running` si es del navegador: la reconstruye la página); `409 busy` mientras mueve el bot, `nothing_to_undo`, `finished` |
| `POST /api/play/:id/rematch` | Fase 22: `{ sameSeed?, engineRev? }` → `201 LiveGame` nueva con los mismos mazos, bot, entrenador y `runner` (la de una partida del navegador pide `engineRev`) |
| `POST /api/play/:id/hint` | Fase 20: `{ ply }` → `LiveGame` con `decision.hint` = la opción del entrenador; `409 stale_decision` / `no_coach` |
| `POST /api/play/:id/abandon` | `LiveGame` (el worker corta el motor en su próximo long-poll) |
| `GET /api/play/:id/replay/raw` | La repetición de la partida terminada (para `/viewer/index.html?url=…`) |

Situaciones para resolver (Fase 24), de tus partidas con entrenador terminadas:

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/puzzles` | `{ items: [{ id: '<partida>-<paso>', gameId, step, ply, turn, options, verdict (lo que costó en la partida), gap, human, rival, finishedAt, attempts, solved, lastVerdict, lastAt }], counts: { total, pending, solved }, coachGames }` (nunca intentadas, falladas, resueltas) |
| `GET /api/puzzles/:id` | `{ id, gameId, ply, turn, state, actions: [{ i, text, action }], human, rival, names, cards, cardIds, attempts, solved }` (sin puntajes) |
| `POST /api/puzzles/:id/answer` | `{ i }` → `{ answer, verdict, gap, rank, best, solved, scores, original: { chosen, verdict, gap }, attempts, next }` |

La página de una partida del navegador (T-015, con sesión; `engine/runner.ts`), como un worker pero sin lease: todas las páginas abiertas de la partida corren el mismo motor con la misma semilla y elecciones, así que mandan lo mismo y la segunda no cambia nada. Cada llamada lleva las elecciones que jugó (`choices`): si el dueño ya eligió, vuelve esa elección; si la partida ya no tiene esas elecciones (un deshacer), `status: 'restart'` (reconstruirla desde `GET …/browser`).

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/play/:id/browser?engineRev=` | `{ id, deckHuman, deckBot, bot, seed, choices, coach, status, engineRev, replayMissing }`; `409 not_browser` (es de un worker) / `engine_mismatch` (otro motor: recargar la app, o la partida es de un motor que ya no está) |
| `PUT /api/play/:id/browser/decision` | `{ choices (ply − 1), ply, turn, state, actions, log, coach?: { scores, best } }` → `{ choice | null, status }` (`waiting`; la elección ya hecha; `restart`; o el estado si terminó) |
| `POST /api/play/:id/browser/choice` | `{ choices, ply }` → long-poll de hasta 25 s → `{ choice | null, status }` |
| `PUT /api/play/:id/browser/end` | `{ choices (todas), winner, turns, state, log }` → `{ ok, status }`; `409 stale_decision` si no son las elecciones de la partida |
| `PUT /api/play/:id/browser/failure` | `{ choices, error }` → `{ ok }` (el motor falló: la partida queda `failed`) |
| `PUT /api/play/:id/browser/replay?choices=1.0.3` | La repetición en gzip (hasta 8 MB) → `{ ok }`; queda la primera; `409 stale_decision` si la partida cambió |

```ts
LiveGame = { id, status: 'queued'|'running'|'waiting'|'done'|'abandoned'|'failed', runner: 'worker'|'browser', bot, botEs, seed, engineRev,
             human: { snapshot, label, deckId }, rival: { snapshot, label, deckId, listKey },
             decision: { ply, turn, state: ViewState (lo que ve tu asiento: la mano del bot oculta), actions: [{ i, text, action }],
                         hintAvailable, hint: number | null } | null,
             coach: boolean, coachReviews: CoachReview[], coachSummary: { decisions, counts: { best, close, inaccuracy,
                         mistake, blunder }, agreement (0–100), hints, worst: CoachReview[≤3] } | null,
             log: [{ ply, turn, actor (0 vos, 1 bot), forced, text, action, ctx: { in_play: [[cardId|null]×4]×2, stadium } }],
             choices, winner: 'you'|'bot'|'tie'|null, turns, finalState, replay: boolean,
             names: { [engineId]: nombre en español }, cards: { [engineId]: { id, name (inglés) } },
             cardIds: { [engineId]: cardId del catálogo }, decks: { human, rival: [{ engineId, count }] }, undos,
             workerOnline, error, createdAt, updatedAt, finishedAt }
CoachReview = { ply, turn, options, chosen, best, chosenText, bestText, gap, rank, verdict: 'best'|'close'|'inaccuracy'|
                'mistake'|'blunder', hinted, chosenAction, bestAction, ctx }
```

Worker (`Bearer tcg_wk_…`, scope `worker:claim`):

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `POST /api/worker/live/claim` | `{ workerId, engineRev, version? }` → long-poll de hasta 25 s → `{ game: { id, deckHuman, deckBot, bot, seed, choices, coach } | null }` (una nueva, o una cuyo worker se fue; las de entrenador, solo para `version` ≥ 0.2.2; nunca las del navegador, T-015) |
| `PUT /api/worker/live/:id/decision` | `{ workerId, ply, turn, state, actions, log, coach?: { scores, best } }` → `{ choice | null, status }` (`choice` ya está si la partida se reconstruye o la elegiste con la PC apagada; `status: restart` si la deshiciste: cortar y volver a pedirla) |
| `POST /api/worker/live/:id/choice` | `{ workerId, ply }` → long-poll de hasta 25 s → `{ choice | null, status }`; renueva el lease; `status: abandoned` corta; `status: restart` (Fase 22, deshacer): cortar el motor y volver a pedir partidas |
| `PUT /api/worker/live/:id/end` | `{ workerId, winner, turns, state, log }` → `{ ok }` |
| `PUT /api/worker/live/:id/failure` | `{ workerId, error }` → `{ ok }` |
| `PUT /api/worker/live/:id/replay?workerId=` | La repetición en gzip → `{ ok }` |

## Avisos (Fase 8)

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/alerts` | `{ items: [{ code: 'new_set'|'unknown_cards'|'new_era_likely'|'limited_pack'|'engine_update'|'backup_drill'|'era_missing_set'|'worker_idle'|'mcp_new_client'|'backup_stale'|'limitless_sync'|'catalog_sync'|'github_check'|'database_size'|'backup_offsite', level: 'info'|'warning', title, detail, link }] }`: set nuevo en el `main` del tracker que el catálogo fijado no tiene (cada 12 h, en producción, `TRACKER_UPSTREAM_CHECK`), listas de la era con cartas que el catálogo no conoce, era nueva probable (35 días), sobre limitado en su última semana, commits nuevos de deckgym; `mcp_new_client` (Fase 43): un token usado por un cliente nuevo en la última semana (`info` el primero del token, `warning` los demás) |

Fase 38 (operación, `docs/OPERACION.md`): `backup_stale` (la copia diaria falló o tiene más de 26 h; con `BACKUP_CRON`), `limitless_sync` (la última corrida falló o ninguna buena en 13 h; con `LIMITLESS_SYNC`), `catalog_sync` (la última actualización del catálogo falló), `github_check` (`info`: los chequeos de GitHub fallan) y `database_size` (la base pasa de 350 MB de los 500 del plan gratis). Fase 39: `backup_offsite` (la subida de la copia al bucket falló o no hubo una buena en 26 h; con `BACKUP_CRON` y el bucket configurado).

## Operación (Fase 38)

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/ops/status` | `{ version, startedAt, uptimeSeconds, memory: { rssMb, heapUsedMb, heapTotalMb, heapLimitMb, externalMb }, database: { sizeMb | null, alertMb, limitMb }, backup: { enabled, last: { at, sizeKb } | null, copies, failure: { at, error } | null, drill: { at, ok } | null }, limitless: { enabled, running, last: { status, startedAt, finishedAt, error } | null, lastDoneAt }, catalog: { trackerCommit, engineRev, lastSync: { status, fetchedAt, error } | null }, github: { token, engineCheck, trackerCheck }, workers: { lastSeenAt, online: [{ name, version, cores, lastSeenAt }] }, queue: { chunks, liveGames } }`: el estado del servidor (con sesión). La tool `system_status` devuelve lo mismo más los avisos vigentes (`alerts: [{ code, level, title }]`). `/healthz` informa como `version` el sha desplegado (`APP_VERSION`, que pone `scripts/deploy.mjs`). Fase 39: `backup.offsite: { enabled, last }` y `retention` (la última limpieza real). |
| `POST /api/ops/retention?apply=1` | Fase 39: la limpieza diaria (04:20, solo con `RETENTION_CRON=true`; también `node dist/cli/retention.js [--apply]`) ahora. **Sin `apply=1` es una vista previa**: las mismas sentencias en una transacción que se deshace. → `{ at, dryRun, replays: { archived, oldJobs, matrixExtra, overBudget }, rawStandings, freedMb, replaysMb, vacuumed }`: repeticiones de simulaciones archivadas hace más de 7 días (queda una por cruce) o terminadas hace más de 30, las de más en una matriz (queda una por cruce) y las más viejas por encima de 100 MB en total; crudos de standings de torneos de más de 180 días. No toca resultados, listas ni datos propios (`docs/RECONSTRUIR.md`). |

## Laboratorio de mazos (T-008)

Probar mazos (míos, de torneo o pegados) contra el **banco del meta** y buscar variantes automáticamente. El banco: los N arquetipos más jugados de la era (5–20, 15 por defecto), cada uno con su lista representativa (la misma regla que la «versión de torneo»: entre las listas repetidas 5 veces o más, la de mejor piso del intervalo; si ninguna, la más jugada) y un **peso** = su cuota de listas normalizada sobre el banco. Una lista que el motor no puede simular cede su lugar a la siguiente del arquetipo (hasta 3) o el arquetipo se saltea. El **puntaje contra el meta** es el % de victorias contra cada rival ponderado por su peso (`W / (W + L + T)` por rival), con un intervalo aproximado (normal sobre las tasas por rival, cada una suavizada +2/+4 para su varianza). Juegan bots: es una pista, nunca se mezcla con torneos ni partidas propias.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/lab/bank?era=&format=&size=` | `{ era, format, size, lists, coverage (0–100), rivals: [{ archetypeId, archetypeName, share, weight, listKey, listLists, listRate, rank, energies, cards: [{ cardId, nameEs, count }] }], skipped: [{ archetypeId, archetypeName, share, reason }], engineRev, attribution }` |
| `POST /api/lab/test` | `{ decks: LabDeck[1..10], era?, format?, size?, gamesPerRival? (100), players? (e2, e2), seed?, label?, cores?, dryRun? }` → `JobSummary` (un trabajo `compare` contra el banco, `lab: 'test'`); con `dryRun`: `{ preview (como /api/simulations/preview), bank }` |
| `POST /api/lab/explore` | `{ deck: LabDeck, locked?: cardId[], config?: { gamesPerRival 10–500 (60), variantsPerRound 1–12 (8), maxRounds 1–20 (12), patience 1–10 (3), confirmGames 0–1000 (100), pool: 'collection'\|'all', acceptZ 0–3 (1) }, era?, format?, size?, players?, seed?, label?, cores?, dryRun? }` → `JobSummary` (`kind: 'explore'`); con `dryRun`: `{ base (foto), bank, pool (cartas candidatas), firstRound: [{ add, remove }], config, games: { perRound, max }, estimatedSeconds: { perRound, max } }`; `400 no_variants` si no hay variantes válidas |
| `POST /api/lab/core` | Fase 19: `{ cards: cardId[1..4], energies?, pool?: 'collection' (por defecto) \| 'all', era?, format?, eventId? }` → `{ era, format, pool, event, basis: { kind: 'together'\|'partial'\|'era', lists, text }, energies, cards: [{ cardId, groupId, nameEs, count, reason: 'core'\|'line'\|'usage', share }], left: [{ cardId, nameEs, reason }], problems: string[], total, attribution }`. Una primera lista alrededor del núcleo con lo que juegan las listas de la era que lo llevan; no encola ni guarda nada |
| `GET /api/lab/jobs` | `{ items: (JobSummary & { mode, era })[] }` (pruebas y búsquedas, las más nuevas primero) |
| `GET /api/lab/jobs/:id` | `LabJob` |

```ts
LabDeck = { deckId, energies? } | { listKey, era?, format?, energies? } | { text, name?, energies? }
        | { cards: [{ cardId, count }], energies, name? }
MetaScore = { value (0–100), ci95: [lo, hi], se, games, rivals, coverage (0–1: peso del banco con partidas) }
LabJob = { job: JobSummary, mode: 'test'|'explore', era, format, size,
           rivals: [{ snapshot, label, archetypeId, archetypeName, share, weight, listKey }],
           decks: [{ snapshot, label, deckId, role: 'best'|'base'|'variant'|'deck', round,
                     search: { score: MetaScore|null, text }, confirm: { score, text } | null,
                     perRival: [{ rival, record, rate }], changes: { add, remove } | null (desde la lista de partida),
                     novelty: { kind: 'played'|'known'|'new', label, swaps, closestArchetype, closestLists, nearbyLists, nearbyEntries },
                     cards, energies, simulable }],
           explore: { config, poolEs, phase: 'search'|'confirm'|'done', stopReason: 'rounds'|'patience'|'no_variants'|null,
                      stopReasonEs, base, best, roundsDone, rounds: [{ index, kind, incumbent, candidates, accepted, decided }],
                      locked } | null,
           note }
```

**Búsqueda** (`explore`): cada ronda juega la mejor lista hasta ahora y K variantes nuevas (1 o 2 cambios de cartas: entra una carta del pool —la colección o todo lo que el motor juega—, con su preevolución si falta, y sale una copia; validadas como mazo) contra el banco; todas las listas de una ronda usan la misma semilla por rival (`baseSeed + ronda × 1000 + rival`). Las cartas que juega la era, y sobre todo las que juegan las listas del arquetipo del mazo, salen más seguido; las que juega todo el arquetipo salen 10 veces menos del mazo. La mejor variante reemplaza a la vigente si su puntaje la supera por más de `acceptZ` errores estándar de la diferencia (la vigente suma todas sus partidas). Para con `maxRounds` rondas, `patience` seguidas sin cambio o sin variantes nuevas; si encontró algo, una ronda de confirmación juega la lista de partida y la encontrada con `confirmGames` partidas nuevas por rival. La API encola cada ronda cuando termina la anterior (el worker no cambia); `advance` bloquea la fila del trabajo para avanzar una sola vez y, si la app se reinicia entre rondas, la retoma al arrancar. **Novedad**: «jugada en torneo» (una lista de la era es exactamente esa), «conocida» (alguna a 6 cambios o menos) o «nueva».

## MCP (Fases 3, 7 y 43)

`POST /api/mcp`: servidor MCP remoto, Streamable HTTP, sin sesiones, con el SDK v2 (`@modelcontextprotocol/server` 2.3.1). Atiende las dos eras del protocolo en el mismo endpoint: 2026-07-28 y la de 2025 con `initialize` (la que usan hoy las apps de Claude y Claude Code). `GET` y `DELETE` responden `405`. Autenticación: `Authorization: Bearer tcg_mcp_…` con scope `mcp:read` (`401` sin token o con uno inválido o revocado, `403` con un token de worker); la cookie de sesión no sirve acá.

Tools de lectura (nombres con `_` porque la API de Claude no acepta `.`): `collection_summary`, `cards_search`, `collection_playable_copies`, `collection_editions`, `decks_list`, `decks_get` (incluye `bestVersions`), `decks_find_by_card`, `decks_validate`, `decks_missing`, `decks_closest`, `decks_random`, `decks_pick_today` (Fase 15: qué mazo llevar hoy, tres números separados), `decks_draw_odds` (Fase 10: la chance de tener una o dos cartas por turno), `matches_stats`, `matches_list`, `rivals_notes` (Fase 12: las notas por rival), `events_check` (Fase 16: eventos, qué mazos y listas cumplen), `matches_luck` (Fase 13: ¿mala racha o mal matchup?) y `packs_recommend` (Fase 4: la misma recomendación, resumida, con lo guardado en la app por defecto; dice el último día de los sobres limitados, lo que solo dan ellos, el mejor sobre cuando terminen y cuándo intercambiar). Torneos (Fase 5): `tournaments_trends` (Fase 11: qué sube y qué baja semana contra semana), `tournaments_matchups` (Fase 9: un arquetipo contra cada rival y lo esperado contra el meta, o la tabla de los más jugados), `tournaments_stats` (por arquetipo o lista exacta; con `archetype` el detalle y con `card` el récord con y sin esa carta), `tournaments_archetype_cards` (Fase 44: núcleo, techs con la diferencia y su intervalo, 2 copias contra 1 y conversión al top 8), `tournaments_buildable` (listas que se pueden armar hoy y las que quedan a 1 o 2 copias) y `tournaments_unlock_cards` (qué carta sola destraba más listas), todas con la era, la media de la era y la atribución a Limitless. Simulación (Fase 6): `simulations_results` (trabajos recientes; con `job`, el ranking de mazos o las combinaciones de optimizar; con `deck`, la columna «simulación» del mazo y, junto con `job`, sus cruces), siempre con bots, n, semilla y motor. Misiones (Fase 8): `collection_pack_luck` (Fase 17: suerte de los sobres), `collection_missions` (misiones de colección con lo que falta). `tournaments_buildable` suma, para las listas a 1 o 2 copias, con qué reemplazar cada carta que falta. Laboratorio (T-008): `lab_meta_bank` (el banco del meta con pesos y listas) y `lab_results` (pruebas y búsquedas; con `job`, cada lista con su puntaje contra el meta, cruces, cambios, novedad y las rondas). Todas devuelven JSON compacto en `content[0].text` y el mismo objeto en `structuredContent`; los errores esperables (carta o mazo inexistente, entrada inválida) vuelven como `isError: true` con el mensaje en español. Cada porcentaje trae `text` con el formato canónico «70 % (n = 10, IC 39,7–89,2 %, orientativo)». Un mazo se indica por su número («13», «mazo 13»: el número con que empieza el nombre o, si no, el id), o por parte del nombre.

Tools de escritura (Fase 7), solo para un token con `mcp:write` (con `mcp:read` solo, ni aparecen en `tools/list`; las instrucciones del servidor suman las reglas de escritura):

| Tool | Entrada → salida |
|---|---|
| `decks_create` | `{ text? \| cards?, energies?, name?, tags?, notes?, saveInvalid? }` → `{ saved, deck }` con validación y faltantes; si no valida no guarda (`saved: false` con `errors`) salvo `saveInvalid`. El texto acepta los formatos de `decks_validate`; un encabezado «### Nombre» da el nombre. Revisión con `source: mcp` |
| `decks_update` | `{ deck, text? \| cards?, energies?, name?, tags?, notes?, revisionNote?, packPriority?, tournamentArchetype? (nombre o id; null = sugerido), builtInGame?, archived?, saveInvalid? }` → `{ saved, deck }`; cartas nuevas: revisión nueva con `source: mcp`, validada antes de guardar. No borra mazos |
| `matches_log` | `{ deck, result: win\|loss\|tie, opponent?, wentFirst?, mode?, note?, playedAt? }` → `{ logged, match, deckRecord }` (`source: mcp`) |
| `matches_update` | `{ id, …campos de matches_log }` → `{ updated, before, match }` |
| `matches_delete` | `{ id }` → `{ deleted, match }` (marcada `destructiveHint`); la fila queda en el registro de Claude (Fase 43) |
| `matches_restore` | Fase 43: `{ id }` → `{ restored, match, deckRecord }`: devuelve una partida que Claude borró, con el mismo id, mazo, revisión y fecha |
| `collection_set` | Fase 43: `{ card (código o nombre), add? \| amount?, collected? }` → `{ changed, card, before, after, playableCopies, sameRowAs?, warning? }`; un nombre con varias ediciones (salvo para restar, si solo hay una con copias) no cambia nada y devuelve `editions` para preguntar |
| `simulations_cancel` | Fase 43: `{ job, archive? }` → `{ cancelled, archived, job }` (marcada `destructiveHint`) |
| `simulations_enqueue` | `{ kind: compare\|matrix\|optimize, decksA?, listsA?: [{ key, era?, format?, energies? }], decksB?, listsB?, games? (200), bots? (e2, e2), seed?, replaySample?, bothOrders?, label?, skipNotSimulable?, remove?: [{ card, count }], candidates?: string[] }` → `{ queued, jobId, seed, pairings, totalGames, estimatedMinutes, notSimulable, workerOnline }`; con mazos no simulables no encola (`queued: false` y los motivos) salvo `skipNotSimulable`. Cartas de optimizar por nombre o código (ambiguas: `isError` con las opciones). Fase 43: `dryRun` devuelve `{ queued: false, dryRun: true, plan }` sin encolar; si la estimación pasa de 30 minutos no encola sin `confirmLong: true` |

| `lab_test` | `{ decks?, lists?, texts?: [{ text, name?, energies? }], size?, era?, format?, games? (100), bots?, seed?, label? }` → `{ queued, jobId, pairings, totalGames, estimatedMinutes, workerOnline }` (mazos contra el banco del meta; las listas pegadas no se guardan como mazos) |
| `lab_explore` | `{ deck? \| list? \| text?, energies?, pool?, locked?: string[] (nombre o código), rounds?, variants?, games?, patience?, confirmGames?, size?, era?, format?, bots?, seed?, label?, dryRun? }` → con `dryRun`, el plan (variantes de la primera ronda, partidas y minutos); si no, `{ queued, jobId, config, rivals, gamesPerRound, maxGames, estimatedMinutes, workerOnline }` |

Todas las de escritura llevan `readOnlyHint: false` e `idempotentHint: false` (registrar dos veces son dos partidas).

**Fase 43.**
- **Registro de escrituras:** cada llamada a una tool de escritura (también las que fallan) queda en `mcp_audit` con el token, el cliente (el producto del `User-Agent`), la tool, los argumentos, la respuesta y el tiempo; se ve en Más → Tokens de API → «Actividad de Claude» y en `GET /api/mcp-audit`. No va en la copia de seguridad.
- **Cliente nuevo:** la primera vez que un cliente usa un token queda en `api_token_clients` y aparece una semana en Avisos (`mcp_new_client`), que llega como notificación.
- **Tools de lectura nuevas:** `workers_status` (workers y cola con la hora estimada de fin), `alerts_list` (los avisos) y `decks_consistency` (la última prueba de consistencia de un mazo). Las tools de torneos suman `scope.dataAsOf` («último torneo del 8/10; última descarga de Limitless 9/10 12:00»).
- **Respuestas más cortas:** `decks_get` es compacto por defecto: cada carta una vez, como «2 Riolu (A2-91): faltan 1», sin el texto exportado ni notas fijas. Con `detail: 'full'` vuelve la forma anterior.
- **`matches_list`:** suma `offset`, `from`, `to`, `mode` y `result`, hasta 100 por página, y devuelve `next: { offset }` cuando hay más.
- **Prompts MCP:** `repaso_semanal` (`week?`), `que_llevo_hoy` y `revisar_mazo` (`deck`); solo encadenan tools de lectura.
- **Errores internos:** devuelven una referencia de 8 caracteres que está en el registro del servidor junto con la tool, el token y el id del pedido.

**Chat entre sesiones (D-021).** Lo usan las sesiones de Claude que programan la app. El chat principal es un archivo en la PC de Santi (la ventana de Santi, el coordinador y las sesiones locales); este es su puente con las sesiones de la nube, que solo llegan a la app por el MCP. El `chat.mjs` del coordinador copia los mensajes en los dos sentidos. Fuera del registro de escrituras y de la copia de seguridad; los mensajes se borran a los 90 días.

**Participantes:** una lista guardada en la app (`session_chat_participants`), cada nombre con su canal: `owner` (Santi: la app o el puente), `relay` (una sesión de la PC: solo el puente) y `connector` (una sesión en la nube: solo el conector MCP). Empieza con Santi; Coordinador, Principal, Laboratorio e Infra (`relay`); Nube-Mejoras y Nube-2 (`connector`). Los nombres son solo ASCII (`^[A-Za-z0-9][A-Za-z0-9 ._-]*$`), así no entra una letra de otro alfabeto que parezca latina. `from`, `to` y `as` tienen que ser exactamente uno de esos nombres, sin importar mayúsculas: cualquier otra cosa («Santi 2») da `400 unknown_participant`; un nombre de la lista usado desde otro canal da `403 wrong_channel`. Santi está siempre y siempre es `owner`: no se cambia ni se quita (`403 owner_fixed`), y `owner` no se le da a otro nombre (`400`). Una sesión que se suma después empieza en el último mensaje: lo anterior cuenta como leído.

| Tool o ruta | Entrada → salida |
|---|---|
| `chat_write` | `{ from, to (un nombre, varios separados por coma o una lista; «todos» llega a todos), topic (una línea), text (hasta 10.000) }` → `{ sent, id, at, from, to }`, con los nombres como están en la lista. `from` tiene que ser una sesión `connector` |
| `chat_read` | `{ as, scope? ('all' \| 'mine'), waitSeconds? (0 a 40), all?, limit? (30) }` → `{ as, messages: [{ id, at, from, to, forYou, topic, text, via }], unreadLeft, participants }`: lo nuevo para `as`, una sesión `connector` (con `all` por defecto, todo lo que escribieron las demás; con `mine`, solo lo dirigido a `as` o a «todos»). Devuelve hasta unos 30.000 caracteres (textos y temas, al menos un mensaje); lo que no entra sigue en `unreadLeft`. Queda leído al final, solo lo devuelto y solo si el cliente sigue conectado. Con `all: true`, los últimos `limit`, sin marcar nada. `via`: el nombre del token por el que llegó. `participants`: los nombres de la lista |
| `GET /api/mcp/chat?after=&limit=` | El puente, con `Authorization: Bearer tcg_mcp_…` y solo `chat:relay`: los mensajes con id mayor que `after` (0 por defecto), en orden, hasta `limit` (100, máximo 500) → `{ messages: [{ id, at, from, to, topic, text, via, relayed, ref }], more }`. `relayed`: lo copió el puente desde la PC (`ref`, su id allá). No marca nada: el puente guarda su posición. Las escrituras van de a una, así un id nunca aparece después de uno mayor |
| `POST /api/mcp/chat` | El puente: `{ from, to, topic, text, ref }` → `201` con el mensaje y `duplicate`. `from` es Santi o una sesión `relay`; `ref` (obligatorio: su id en el chat de la PC) hace que reenviarlo devuelva el ya copiado (`duplicate: true`); el mismo `ref` con otro remitente, destinatarios, tema o texto da `409 ref_conflict` |
| `GET /api/mcp/chat/participants` | El puente: `{ items: [{ name, channel, createdAt }] }` |
| `POST /api/mcp/chat/participants` | El puente suma una sesión nueva: `{ name, channel: 'relay' \| 'connector' }` → `201` (o `200` si ya estaba con ese canal). `owner` da `400`, Santi `403`; un nombre que ya está con otro canal, `409` |
| `GET /api/chat/participants` | Con la sesión de Santi: `{ items: [{ name, channel, createdAt }] }` |
| `PUT /api/chat/participants` | Con la sesión: `{ name, channel: 'relay' \| 'connector' }` → la suma o le cambia el canal (o cómo se escribe el nombre). «todos» u `owner` dan `400`; Santi, `403` |
| `DELETE /api/chat/participants/:name` | Con la sesión: la saca de la lista (`204`; `404` si no estaba; Santi, `403`). Sus mensajes quedan |

Cada pedido del puente anota su cliente en el token, como el MCP: otro cliente con el token del puente aparece en Avisos.

Conectar:
- **Claude Code:** crear un token MCP en Más → Tokens de API y registrar `claude mcp add --transport http tcg https://tcg-pocket.fly.dev/api/mcp --header "Authorization: Bearer tcg_mcp_…"`.
- **Apps de Claude (web, escritorio, celular):** Configuración → Conectores → Añadir conector personalizado, URL `https://tcg-pocket.fly.dev/api/mcp`, «Encabezados de solicitud»: `Authorization` = `Bearer tcg_mcp_…` (DECISIONES A.6).

## Copia de seguridad

| Método y ruta | Respuesta |
|---|---|
| `GET /api/backup/export` | Descarga `tcgpocket-backup-AAAAMMDD.json.gz` (`application/gzip`; todo lo propio, partidas incluidas; ver abajo y PLAN §3.9) |
| `POST /api/backup/import?mode=dry-run|replace` | `multipart/form-data` con `file` (`.json.gz` o `.json`, ≤ 50 MB); sin `mode`: `dry-run` → `{ schemaVersion, exportedAt, appVersion, catalogCommit, diff: { current, incoming, notices: string[], needsReview, unknownCardIds } }` (`current`/`incoming` son conteos por tabla, `matches` incluido); `replace` → `{ applied: true, counts, notices }`. Errores: `400 invalid_backup` (no es gzip/JSON, no tiene la forma, descomprimido supera 128 MB o tiene partidas con referencias rotas), `400 unsupported_schema` (`schemaVersion` distinto de 1 a 7), `400 unknown_card` en `replace` si referencia cartas o grupos que no están en el catálogo cargado |
| `GET /api/backup/blobs` | `{ items: [{ id, createdAt, sizeBytes }] }` (copias diarias guardadas, más reciente primero; se conservan las últimas 14) |
| `GET /api/backup/blobs/:id` | Descarga (`application/gzip`, nombre con la fecha de la copia) |
| `GET /api/backup/offsite` | Fase 39: `{ enabled, last: { at, ok, key, error, kept, pruneError? } | null, check: { at, ok, key, bytes, sha256, error } | null }` (`check`: la comprobación mensual de la copia más nueva del bucket): la copia fuera de Supabase (bucket S3 de Tigris; `enabled` con los secretos `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` y `BUCKET_NAME`) |
| `POST /api/backup/offsite` | Fase 39: sube ahora la copia diaria más nueva (una nueva solo si no hay ninguna, así no rotan las de la base) → `{ result: { at, ok, key, error, kept, pruneError } }` (una falla queda en `result`, no es un error HTTP; `pruneError`: subió pero no pudo borrar las viejas); `400 validation` sin el bucket configurado. La copia diaria de las 04:00 también se sube; en el bucket quedan las de los últimos 30 días (`backups/tcg-pocket-<fecha>.json.gz`, por la fecha del nombre) |

Documento (`schemaVersion: 7`): `{ schemaVersion, exportedAt, appVersion, catalogCommit, engineRev, settings[], rarityRules[], collection: { stock[], imports[] (metadatos + filas, sin el archivo crudo), adjustments[] }, decks[] (con `revisions[]` y `changes[]`), matches[] (con `deckId` y `deckRevisionId`), packs[] (`{ id, available, pointsBalance, limited?, limitedUntil? }`, Fase 4; sin `limited`/`limitedUntil` se mantienen los actuales), tournaments (`{ sets[], archetypeAliases[] }`, Fase 5; los mazos llevan `tournamentArchetypeId`; los torneos de Limitless no viajan: se vuelven a bajar), tokens[] (solo metadatos: no se restauran), playedGames[] (Fase 8, D-019: las partidas contra el bot terminadas, solo el resultado: `{ id, humanLabel, rivalLabel, bot, seed, engineRev, winner: 'you'|'bot'|'tie', turns, createdAt, finishedAt }`; al restaurar reemplazan las terminadas y las que se están jugando siguen), rivalNotes[] (Fase 12: `{ key, label, archetypeId, text, createdAt, updatedAt }`; al restaurar se reemplazan), events[] (Fase 16: `{ id, name, startsOn, endsOn, rules, notes, createdAt, updatedAt }`; al restaurar se reemplazan) }`, con los ids numéricos y las fechas de la base, así `replace` deja una base idéntica (y un nuevo `export` igual salvo `exportedAt`). Se leen las versiones 1 (Fase 1, sin `matches`: el dry-run avisa que restaurarla borra las partidas actuales), 2 (sin `packs`: se mantiene la disponibilidad actual), 3 (sin tabla de eras ni fusiones de arquetipos: se mantienen las actuales), 4 (sin `playedGames`: se mantienen las partidas contra el bot actuales), 5 (sin `rivalNotes`: se mantienen las notas actuales), 6 (sin `events`: se mantienen los eventos actuales) y 7. Una partida cuyo mazo o revisión no está en el archivo da `400 invalid_backup` con `details` (`[{ id, deckId, deckRevisionId }]`). `replace` corre en una transacción: borra partidas, mazos, ajustes, stock, importaciones y configuración, inserta todo con sus ids, reconstruye `deck_cards` y reajusta las secuencias; `rarity_rules` se pisan por rareza. Si `catalogCommit` difiere del catálogo cargado, `notices` avisa `needs_review` (un backup no se remapea: el archivo no trae el catálogo de su commit, DECISIONES 24.2). La copia diaria (04:00, `BACKUP_CRON`) guarda el mismo documento en `backup_blobs`.

## Configuración

| Método y ruta | Respuesta |
|---|---|
| `GET /api/settings` | `{ [key]: value }` (solo las claves guardadas) |
| `PUT /api/settings/:key` | `{ value }` (cualquier JSON) → `{ key, value }`; `400 validation` si la clave no es una de `ui`, `alpha`, `rarityFilter`, `tradeableRarities`, `rarityCosts`, `minPlayers` (torneos, entero ≥ 1), `backfillDays`, `cores`, `defaultBot`, `packModel`, `limitedBoost`, `packDeckTarget` (`saved` o `tournament`), `packPoints` (`{ [expansionId]: puntos guardados }`) |

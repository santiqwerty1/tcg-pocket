> Informe de investigación automático de la Fase 0 (6/10/2026), generado por agentes de Claude Code sobre `refs/tracker` @ 3ab58f1, `refs/deckgym-core` @ fb792ebf, la API de Limitless y documentación pública. Las rutas `C:\Users\<usuario>\AppData\Local\Temp\...` son scripts descartables de la sesión. Los números de colección se calcularon con la exportación del 1/10/2026 que estaba en Descargas; el plan usa la del 6/10/2026 en `docs/context/`. Las secciones "Preguntas abiertas" quedaron consolidadas en `docs/PLAN.md` §8.

# limitless

## Resumen
Investigué la API de Limitless para M5 con 10 de las 12 llamadas permitidas (todas 200 salvo /games/POCKET/decks → 400 "Invalid Access Key"). Sin API key hay 4 endpoints: /tournaments (filtros game/format/organizerId/limit/page; limit=500 funciona), /tournaments/{id}/details, /standings y /pairings; la key solo suma el endpoint de reglas de arquetipos, mayor cuota y webhooks, y Limitless la da solo a proyectos públicos. Dato clave: los torneos "Standard" de POCKET vienen con format:null (format=STANDARD devuelve []), así que "formato vigente" se infiere por fecha: era = último set no-Deluxe (A4b/B4b no abren era) con release <= fecha del torneo; validado contra el sitio (B4a: 154 torneos/12.223 jugadores en Limitless vs 154/12.616 con mi regla "format null y players>=12", ventana 27/8-6/10). Volumen: 5,2 torneos/día en los últimos 41 días (88% con >=16 jugadores, ~370 jugadores/día); backfill de 60 días ~300 torneos = 300-600 llamadas = 1-1,5 h al límite; sync diario ~12 llamadas. Standings: decklist {pokemon,trainer,energy[1-3]} con set+number que mapea 100% (6.306/6.306 refs) a card_id '<set>-<number>' del tracker con nombres idénticos; placing puede ser null en jugadores con drop; empates reales en BO1 (9% de partidas). Media de victorias contando empates y derrotas automáticas: 43,8% (NOEX BO1) y 48,0% (PMPT45 BO3), consistente con el 46,7% del brief. Formatos de texto: el botón "Copy to Clipboard" de Limitless produce "<count> <name> <SET> <NUMBER>" + "Energy: X" (CRLF), byte-compatible con el parser de deckgym; el juego solo comparte mazos por código QR (binario con entity IDs, no set/number). pocket.limitlesstcg.com no tiene español; TCGdex tiene texto en español pero solo hasta B2a. Prior art reutilizable: mogja9/ptcgp-tracker (MIT, sync con rate-limit), indren9/ptcgp_ranking (MIT), PocketDecks tier-list (AGPL), KevinGutowski/tcgp-deck-qr (MIT, códigos QR).

## Hallazgos
# Limitless para M5: API, formato vigente, formatos de texto y diseño del sync

Todo lo de abajo fue verificado el 6/10/2026 con curl/node sobre respuestas reales guardadas en el scratchpad (`.../scratchpad/api/*.json`, `*.headers`, `.../scratchpad/web/*.html`, `.../scratchpad/docs/*.html`). Donde digo "no verificado" es porque no pude.

## 0. Registro de llamadas a la API (10 de 12)

| # | URL | Status | Bytes | `RateLimit` |
|---|---|---|---|---|
| 1 | `GET /api/tournaments?game=POCKET&limit=200` | 200 | 36.567 (200 items) | `"50-in-5min"; r=49; t=300` |
| 2 | `GET /api/tournaments?game=POCKET&limit=200&page=2` | 200 | 36.372 (200 items) | `r=48; t=255` |
| 3 | `GET /api/tournaments/6a9ebbfcab080c8c957fcc9a/standings` (NOEX, 79 jug.) | 200 | 78.858 | `r=47; t=199` |
| 4 | `GET /api/tournaments/6a95b87b629039f77d8a6954/standings` (PMPT #45, 393 jug.) | 200 | 425.829 | `r=49; t=300` |
| 5 | `GET /api/tournaments/6a95b87b629039f77d8a6954/details` | 200 | 486 | `r=48; t=299` |
| 6 | `GET /api/games` | 200 | 3.645 | `r=47; t=298` |
| 7 | `GET /api/games/POCKET/decks` (sin key) | **400** `"Invalid Access Key"` | 20 | `r=46; t=195` |
| 8 | `GET /api/tournaments?game=POCKET&format=NOEX&limit=50` | 200 | 9.424 (50 items) | `r=46; t=127` |
| 9 | `GET /api/tournaments?game=POCKET&format=STANDARD&limit=50` | 200 | 2 (`[]`) | `r=45; t=24` |
| 10 | `GET /api/tournaments?game=POCKET&limit=500&page=3` | 200 | 91.358 (500 items, 30/3/2026 → 25/12/2025) | `r=45; t=126` |

Todas las respuestas traen además `RateLimit-Policy: "50-in-5min"; q=50; w=300; pk=:NzQ2YzJhOWRmMmZm:` (pk = clave de partición, constante para esta IP), `Access-Control-Allow-Origin: *`, `ETag` débil, `Server: nginx`, `X-Powered-By: Express`.

**Semántica observada del header.** `r` = requests restantes, `t` = segundos hasta que se reinicia la ventana, `q` = cuota, `w` = ventana en segundos. Pero la secuencia observada (`r` 49→48→47→**49**→48→47→46→46→45→45 y `t` 300→255→199→**300**→299→298→**195**→127→**24**→126) no es la de un único contador: los valores saltan como si hubiera varios procesos backend con contadores independientes detrás del nginx. Conclusión práctica: **no confiar en `r` como cuenta global**; presupuestar conservadoramente (p. ej. 40/5 min) y tratar un 429 como la señal autoritativa. ptcgp-tracker (ver §8) lee `ratelimit-reset`/`retry-after` al recibir 429 (`src/lib/limitless.ts:78-82`).

## 1. Documentación (docs.limitlesstcg.com)

Páginas existentes: `/developer.html`, `/developer/tournaments.html`, `/developer/games.html`, `/developer/webhooks.html`. **No existen** `/developer/decks`, `/decklists`, `/players`, `/formats` (404 las cuatro).

### Autenticación y key
- Sin key se accede a todo **salvo** `GET /games/{id}/decks` (reglas de categorización de arquetipos). Verificado: sin key devuelve 400 `"Invalid Access Key"`.
- La key se pide en `https://play.limitlesstcg.com/account/settings/api` y, textual: no son para uso privado, solo para proyectos públicos con caso de uso legítimo. Da cuota más alta, el endpoint de decks y la posibilidad de registrar un **webhook** (`tournament:ended`, POST con `{secret, event:{name, tournamentId, game}}`). Para una app personal **asumir que no habrá key**.
- Se pasa como query `?key=` o header `X-Access-Key`.
- Términos/atribución: la documentación no impone atribución; `play.limitlesstcg.com/tos` y `limitlesstcg.com/legal` existen pero no los leí en detalle. El pie de pocket.limitlesstcg.com aclara que el texto e imágenes de cartas son copyright de TPC/DeNA/Creatures. Recomiendo citar "Datos de torneo: Limitless (play.limitlesstcg.com)" en la UI.

### Endpoints (base `https://play.limitlesstcg.com/api`)

**`GET /tournaments`** — parámetros opcionales `game`, `format`, `organizerId`, `limit` (default 50; **500 funciona**, máximo no documentado), `page` (1-based; page=3 con limit=500 devolvió items 1001-1500). Orden: más reciente primero por `date`. Respuesta: `{id, game, format, name, date (ISO, hora de inicio programada), players, organizerId}`. **Importante:** `format` viene `null` para los torneos "Standard" de POCKET (ver §3) y `format=STANDARD` devuelve `[]`; `format=NOEX` sí filtra (50 resultados, hasta 17/7/2026 hay 6 en ~2,5 meses).

**`GET /tournaments/{id}/details`** — agrega `organizer {id, name, logo}`, `platform` (vacío en POCKET), `decklists` (bool), `isPublic`, `isOnline`, `phases[{phase, type (SWISS | SINGLE_BRACKET | ...), rounds, mode (BO1|BO3|BO5)}]`, `bannedCards[]`, `specialRules[]`. Ejemplo real PMPT #45: `decklists:true, isPublic:true, isOnline:true, phases:[{1,SWISS,7,BO3},{2,SINGLE_BRACKET,1,BO3}]`, organizer `{id:13, name:"PocketMads"}`. 486 bytes.

**`GET /tournaments/{id}/standings`** — array de `{player (id estable), name, country (ISO-2 o null), placing, record {wins, losses, ties}, decklist, deck, drop}`. Para POCKET `decklist = {pokemon:[{count,set,number,name}], trainer:[...], energy:[string]}` (`energy` ausente en el torneo NOEX del 9/9, presente en PMPT #45; `number` es **string sin ceros a la izquierda**, p. ej. `"5"`, `"7"`). `deck = {id, name, icons[]}` o null.

**`GET /tournaments/{id}/pairings`** — `{round, phase, table|match, player1, player2 (vacío = bye o derrota automática por tardanza), winner (id | 0 empate | -1 doble derrota)}`. No lo llamé. Sirve para enfrentamientos entre arquetipos (M6) pero duplica llamadas; dejarlo opcional.

**`GET /games`** — POCKET: `{id:"POCKET", name:"Pokémon TCG Pocket", formats:{STANDARD:"Standard", NOEX:"NOEX"}, platforms:{}, metagame:true}`. Otros games: PTCG, VGC, OP, DCG, FW, DBS, BSS, GUNDAM, LORCANA, SWU, RB, PGO, other.

**`GET /games/{id}/decks`** (requiere key) — reglas `{identifier, name, cards[{count,name,set,number}], priority, variants[], icons, generation}`. Doc: las reglas "pueden actualizarse o borrarse en cualquier momento".

## 2. Hechos verificados sobre los datos

### 2a. Volumen de torneos (400 más recientes: 20/7 → 6/10/2026, 79 días)
- 400 torneos únicos, 28.193 jugadores; formato: `null` 293, `CUSTOM` 102, `NOEX` 5.
- **5,06 torneos/día** en 79 días; **5,22/día en los últimos 41 días** (27/8 → 6/10: 214 torneos, 189 con ≥16 jugadores = **88,3%**, ~369 jugadores/día).
- Tamaño: mín 3, mediana 50, p90 140, máx 484 (PMPT #41, 8/8). ≥8: 390; ≥16: 351; ≥32: 268; ≥64: 159; ≥128: 49.
- 49 organizadores; los 2 mayores (ids 2461 y 2429) hacen 127/400 y son casi todos `CUSTOM` ("Lagoon Serenity Format", "Rising Star Format"): **CUSTOM = reglas caseras (draft, bans, solo 70 HP, etc.), hay que excluirlos** de las estadísticas del formato.
- Horas de inicio UTC concentradas en 02h (54), 17h (38), 22-23h (62): el torneo de un día termina típicamente dentro de las 6-8 h; "fecha + 1 día" como umbral de completitud es seguro.
- Sin diferencia fuerte por día de semana (52-66 por día).

### 2b. Ventana de referencia del brief (B4a, 27/8 → 5/10)
Con la lista: 212 torneos totales (160 `null`, 49 `CUSTOM`, 3 `NOEX`), 14.984 jugadores. Solo `null`: 160 torneos / 12.564 jugadores; `null` y ≥16: **143 / 12.377**; `null` y ≥12: 154 / 12.616. El brief dice 151 torneos / 11.975 listas: coincide en orden de magnitud (la diferencia son el umbral de tamaño usado y que "listas" excluye jugadores sin decklist). Limitless muestra para set=B4a (hasta 6/10): **154 torneos, 12.223 jugadores, 31.905 partidas** (`decks.html`).

### 2c. Casos borde en standings (torneo NOEX 6a9ebbfc…, 79 jug., SWISS BO1 presumible; PMPT #45, 393 jug., BO3)
| Caso | NOEX (79) | PMPT #45 (393) |
|---|---|---|
| `deck: null` | 0 | 0 |
| `decklist: null` | 0 | 0 |
| `placing: null` | **38** (= todos los que tienen `drop`) | 0 (260 con `drop`, todos con placing 1-393 únicos) |
| `drop != null` | 38 (rondas 3-5) | 260 (casi todos `drop: 7` = no pasaron al top cut) |
| `record.ties > 0` | 31 jugadores; 40 empates de 434 partidas (**9,2%**, BO1) | 18 jugadores; 20 de 2.190 (0,9%) |
| `energy` | ausente en todas | 1 tipo: 367, 2 tipos: 23 (p. ej. `["Lightning","Psychic"]`), 3 tipos: 3 |
| tamaño de lista | 20 en 100% | 20 en 100% |
| promos | `P-A` 148 refs (Research 7, Poké Ball 5, X Speed 2, Red Card 6) | `P-A` 833 + `P-B` 12 (Electrike 43, Zygarde 51, Mega Houndoom ex 80…) |
| arquetipos distintos | 49 | 128 |
| listas exactas distintas (nombre+count) | 68 de 79 | 277 de 393 (máx. 19 iguales) |

- **`placing` semántica:** posición final; es `null` cuando el organizador no asignó posición a los que abandonaron (torneo NOEX) pero en otros torneos los drop sí tienen posición. Regla: `placing` nullable; el récord es válido igual.
- No vi `deck:null` ni `decklist:null` en 472 jugadores, pero la doc dice que `decklist` existe "si está disponible" y `deck` solo si el juego lo soporta: tratarlos como nullable (torneos con `details.decklists:false`).
- Totales W≠L: NOEX 190-204-40, PMPT 1051-1119-20. Las derrotas superan a las victorias por byes/derrotas automáticas/doble derrota: **por eso la media baja de 50%** (43,8% y 48,0% con la fórmula del brief; 48,2% y 48,4% sin empates).
- El torneo NOEX tenía 1 sola referencia a un Pokémon " ex" en 1.018 cartas, consistente con su formato.

### 2d. Mapeo set+number → `card_id` del tracker
Comparé cada referencia `<set>-<number>` contra `refs/tracker/frontend/assets/cards.json` (`card_id`, `name`): **6.306/6.306 referencias mapean (1.018 + 5.288) y 0 nombres difieren**. Incluye `P-A-7`, `P-B-80`, sets A1…B4a. El tracker tiene 117 ids `P-A-*` y 103 `P-B-*`. Regla: `card_id = set + "-" + number` sin padding (Limitless no pone ceros; deckgym sí los agrega internamente, `src/deck.rs:173`). Set más nuevo visto en listas de ambos torneos: B4a (nadie usó aún reimpresiones B4b porque son del 30/9).

## 3. "Formato vigente": regla de era

Evidencia del sitio (`play.limitlesstcg.com/decks?game=POCKET`): selectores `format` = {STANDARD (default), NOEX} y `set` con **B4a seleccionado como más nuevo**; la lista de sets va B4a, B4, B3b, B3a, B3, B2b, B2a, B2, B1a, B1, A4a, A4, A3b, A3a, A3, A2b, A2a, A2, A1a, A1. **A4b y B4b (Deluxe) no aparecen**: un Deluxe no abre era. Además hay un checkbox "Combine related deck variants into one archetype".

Validación de la regla "era = por fecha": Limitless set=B4 → 102 torneos / 9.643 jug.; set=B3b → 104 / 8.554; set=B4a → 154 / 12.223. Con mi lista, `format==null` y fecha en [30/7, 27/8) da 110 torneos (99 con ≥16, 9.820 jug.); [27/8, 7/10) da 161 (144 con ≥16; **154 con ≥12 = 12.616 jug.**). El número de torneos coincide exactamente con un umbral ≈12 jugadores; los jugadores difieren ~3% (Limitless probablemente cuenta solo jugadores con lista o con partidas). Conclusión: Limitless asigna el set **por fecha del torneo** y excluye CUSTOM (y probablemente torneos sin decklists y muy chicos).

**Regla propuesta para la app**
1. `era(t) = max{ set ∈ SETS_NO_DELUXE : release_date(set) <= date(t) }` (comparar en UTC; en el día de lanzamiento el torneo cuenta para el set nuevo, como hace Limitless).
2. `formato(t) = t.format ?? "STANDARD"`; excluir `CUSTOM`; `NOEX` es filtro aparte.
3. Control cruzado: `max_set_en_listas(t)` (orden de la tabla de abajo). Si es más nuevo que `era(t)` → torneo pre-release (hay "Pré-Release" CUSTOM) → marcar `era_conflict`. Las cartas B4b/A4b se normalizan al grupo funcional, así que no alteran la era.
4. "Formato vigente" = era de hoy; la UI muestra "B4a desde 27/8/2026, N torneos, M listas" y permite elegir eras anteriores.

**Fechas de lanzamiento** (tabla de `pocket.limitlesstcg.com/cards`, columna Release Date; Bulbapedia devolvió 403 a curl y WebFetch, no pude contrastar allí; búsqueda web coincide en A1-A2b):

| Set | Nombre | Lanzamiento | Cartas (Limitless) |
|---|---|---|---|
| A1 | Genetic Apex | 30/10/2024 | 286 |
| A1a | Mythical Island | 17/12/2024 | 86 |
| A2 | Space-Time Smackdown | 29/1/2025 (otras fuentes: 30/1) | 207 |
| A2a | Triumphant Light | 28/2/2025 | 96 |
| A2b | Shining Revelry | 27/3/2025 | 111 |
| A3 | Celestial Guardians | 30/4/2025 | 239 |
| A3a | Extradimensional Crisis | 29/5/2025 | 103 |
| A3b | Eevee Grove | 26/6/2025 | 107 |
| A4 | Wisdom of Sea and Sky | 30/7/2025 | 241 |
| A4a | Secluded Springs | 28/8/2025 | 105 |
| A4b | Deluxe Pack: ex (**no abre era**) | 30/9/2025 | 379 |
| B1 | Mega Rising | 30/10/2025 | 331 |
| B1a | Crimson Blaze | 17/12/2025 | 103 |
| B2 | Fantastical Parade | 29/1/2026 | 234 |
| B2a | Paldean Wonders | 26/2/2026 | 131 |
| B2b | Mega Shine | 26/3/2026 | 117 |
| B3 | Pulsing Aura | 28/4/2026 | 234 |
| B3a | Paradox Drive | 28/5/2026 | 109 |
| B3b | Everyday Wonders | 30/6/2026 | 106 |
| B4 | Ruler of the Skies | 30/7/2026 | 233 |
| B4a | Team Rocket's Ambition | 27/8/2026 | 110 |
| B4b | Deluxe Pack: Mega (**no abre era**) | 30/9/2026 | 429 |
| P-A / P-B | Promo | — | 117 / 103 |

Cadencia: set grande el último jueves/miércoles de un mes, mini a los ~30 días, Deluxe al mes siguiente; la próxima era (B5?) cae alrededor del 29/10/2026. La tabla de sets debe vivir en datos editables, no en código.

## 4. Formatos de texto de mazos

### 4a. Limitless, página de decklist de torneo (`/tournament/<id|alias>/player/<player>/decklist`)
Tiene botón `button.export` "Copy to Clipboard" que copia la constante JS `decklist` (verificado en `decklist.html` de un jugador de PMPT #45). Texto exacto (CRLF, bloques separados por línea vacía, sin encabezados `Pokémon:`/`Trainer:`, energía al final):
```
2 Treecko B3 5
1 Grovyle B3 6
2 Mega Sceptile ex B3 8
1 Froakie A1 87
1 Greninja A1 89
1 Volbeat B4a 1
1 Pheromosa A3a 7

2 Professor's Research P-A 7
2 Copycat B1 225
1 Cyrus A2 150
2 Rare Candy A3 144
2 Poké Ball P-A 5
1 Small Balloon B3b 64
1 Fragrant Forest B3 153

Energy: Grass
```
Gramática: `<count> <name…> <SET> <NUMBER>`; `Energy: A, B` con nombres en inglés. La misma página enlaza "Open in Deck Builder" → `https://my.limitlesstcg.com/builder/?i=3221B35121B36221B38122A187122A189131B4a1131A3a7231P0A7223B1225123A2150223A3144231P0A5132B3b64123B3153`. Decodificado por inspección (no documentado): `3` = versión; luego por carta `count(1 dígito) len(set)(1) len(number)(1) set number`, con `P-A` codificado como `P0A` (p. ej. `231P0A7` = 2× P-A 7; `132B3b64` = 1× B3b 64). No incluye energía.

### 4b. my.limitlesstcg.com/builder?game=pocket
SPA SvelteKit (requiere JS/login para exportar); la meta description menciona "image exports, playtesting". No pude ver su export de texto sin navegador; asumo el mismo formato de 4a (es el que importa vía `?i=`). **No verificado.**

### 4c. deckgym "Copy as Text" (README `refs/deckgym-core/README.md:15`)
deckgym.com fue inalcanzable desde esta máquina (connection reset con curl HTTP/1.1 y WebFetch), así que lo documento por los archivos del repo. 30 de 32 `example_decks/*.txt` usan el formato actual, p. ej. `example_decks/mega-absol-hydreigon.txt`:
```
Energy: Darkness
1 Absol A3 112
1 Chingling B1 109
1 Mega Absol ex B1 151
2 Deino B1 155
...
2 Professor's Research A4b 373
1 X Speed P-A 2
```
(LF, `Energy:` primero, sin encabezados; se ve que deckgym usa ediciones concretas como `A4b 373`). Dos archivos viejos (`venusaur-exeggutor.txt`, `weezing-arbok.txt`) usan el formato con encabezados `Pokémon: 10` / `Trainer: 10` y números con ceros (`A1 001`, `P-A 007`), que es el formato de export de Limitless para PTCG Live.

### 4d. Compatibilidad con el parser de deckgym (`src/deck.rs:43-96, 161-181`)
- Ignora líneas vacías y las que empiezan con `Pokémon:`/`Trainer:` (línea 49-53); `Energy:` en cualquier posición, separado por comas (55-74); si falta, infiere energías de los Pokémon (81-87).
- Carta: `split_whitespace`, count = primer token, set = penúltimo, number = último, padded a 3 (`format!("{number:0>3}")`, línea 173) y busca `"{set} {number}"` en `CARD_ID_MAP` (`src/card_ids.rs:8652`). Nombres con espacios/apóstrofes/acentos no importan porque solo usa los extremos.
- Energías aceptadas (`src/models/card.rs:39-53`): Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Dragon, Colorless; otro nombre → `expect` → **panic** (línea 71 de deck.rs), no error recuperable.
- `card_ids.rs` tiene 103 ids `P-B` y 429 `B4b`.
- **Veredicto:** el texto de "Copy to Clipboard" de Limitless es **byte-compatible** con deckgym (CRLF se elimina con `trim`, línea 48), y el JSON de standings se convierte trivialmente a ese texto (`${count} ${name} ${set} ${number}` + `Energy: ${energy.join(", ")}`). Único riesgo: energía ausente en el JSON (torneo NOEX) → deckgym infiere por tipos de Pokémon, lo que puede dar `Dragon`/`Colorless` y un mazo `is_valid()==false` (líneas 109-112).

### 4e. Código de mazo del juego
Desde la actualización del 29/7/2026 el juego comparte mazos por **código 2D (QR)**, no por string de texto (Serebii 29/7/2026). `KevinGutowski/tcgp-deck-qr` (MIT) documenta el payload (`docs/format.md`): Base64 de `u8 trainer_count, trainer_count×u24be (entity_id+10.000.000), u8 pokemon_count, pokemon_count×u24be entity_id, u8 energy_count, energy_count×u8` (Grass 1, Fire 2, Water 3, Lightning 4, Psychic 5, Fighting 6, Darkness 7, Metal 8; Dragon 10 y Colorless 11 existen pero Dragon crashea el juego). Los IDs son **entidades funcionales** (artes alternativos comparten id), tomados del nombre de asset `cPK_10_018340_00_MIRAIDONex_RR.webp` → 18340. El `internal_id` del tracker **no** es ese id (Miraidon ex B3a-19 → 1180867; Bulbasaur A1-1 → 65600), así que para generar/leer QR haría falta la base comunitaria que usa tcgp-deck-qr (opcional, fase tardía). La librería importa el texto "Copy to Clipboard" de Limitless y genera QR versión 9, EC alto.

## 5. Texto de cartas en español
`pocket.limitlesstcg.com` **no tiene** selector de idioma: `html lang="en"`, `data-lang="en"` en el buscador, sin `hreflang` ni rutas `/es/`; `?lang=es` devuelve la misma página en inglés (14.595 bytes idénticos) y `/es/cards/B2/113` da 404. Alternativas:
- **TCGdex** (`api.tcgdex.net/v2/es/...`, serie `tcgp`): tiene nombres y ataques en español (`/v2/es/cards/A1-001` → "Látigo Cepa", costes "Planta, Incolora"), pero el set más nuevo es **B2a** (sin B2b…B4b) y `B2` devuelve 0 cartas en es: incompleto y atrasado.
- Tracker: `pokemon_translations.json` (1.153 entradas, `es-ES`), `trainers_translations.json`, `tools_translations.json`: solo nombres, no texto de ataques.
- `PocketDecks/pokemon-tcg-pocket-cards` (AGPL) y `flibustier/pokemon-tcg-pocket-database` (MIT): no vi campos multilenguaje en sus README.
- Conclusión: texto de reglas en español no está disponible de forma confiable; mantener inglés (Limitless) con nombre en español, como propone el brief. Posible fuente futura: capturas del juego o TCGdex cuando se ponga al día.

## 6. Arquetipos (`deck`) y lista exacta

- `deck.id` es un slug de las cartas clave con el set para desambiguar homónimos: `mega-lucario-ex-b3-lucario-a2`, `hydreigon-b1`, `hydreigon-b1-absol-b4`, `mega-altaria-ex-chingling-b1`, `magnezone-heliolisk-b1a`; `name` legible; `icons` = sprites (`altaria-mega`, `chingling`). En el sitio el slug es la URL `/decks/<id>?game=POCKET&format=standard&set=B4a`.
- Los ids salen de las reglas de `/games/POCKET/decks` (que no tenemos) y Limitless avisa que las reglas **cambian o se borran**; además hay variantes jerárquicas (checkbox "Combine related deck variants"). Por lo tanto: **no son estables**; guardar `deck_id`, `deck_name`, `icons` tal como vinieron en cada standing, y tener una tabla propia `archetype_alias` para fusionar (p. ej. `hydreigon-b1` + `hydreigon-b1-absol-b4`). `deck:null` = ninguna regla matcheó (o sin lista); mostrarlo como "Sin arquetipo".
- **Lista exacta**: clave = multiconjunto de (nombre, count) sobre pokemon+trainer, ignorando set/number (así B4b-373 y P-A-7 Research colapsan). Implementación: ordenar `name×count`, unir con `|`, hashear (sha1). Mejor aún: mapear cada set-number al **grupo funcional** del tracker (`alternate_versions`) y usar el id de grupo en vez del nombre, porque "mismo nombre, distinto texto" (Riolu A2-91 vs B3-79) son cartas distintas; el brief pide "por nombre", así que ofrecer ambas claves: `list_key_by_name` y `list_key_by_functional`.
- **Récord por lista/arquetipo**: sumar `wins`, `losses`, `ties` de cada standing. Fórmula del brief: `WR = W / (W + L + T)`, con empates y abandonos (las derrotas automáticas ya están en `losses`); mostrar `n_listas`, `n_partidas = W+L+T`, `W-L-T`, WR e intervalo de **Wilson 95%**: centro `(p + z²/2n)/(1 + z²/n)`, semiancho `z·√(p(1-p)/n + z²/4n²)/(1 + z²/n)`, `z=1,96`, `n = W+L+T`. Ejemplos calculados: 51,1% en 268 partidas → [45,2; 57,0]; 53,8% en 80 → [42,9; 64,3]; 55,6% en 22 → [34,7; 73,1] (por eso <30 listas = orientativo); media NOEX 190/434 → [39,2; 48,5]; PMPT #45 1051/2190 → [45,9; 50,1]. Nota: Wilson asume partidas independientes y las de un mismo jugador no lo son; decirlo en la UI. Comparar siempre contra la media de la era (46,7% en el brief) y no contra 50%.
- Consultas del brief: "con y sin carta X" = partir las listas del arquetipo por `count(X) >= k`; "qué puedo armar" = cada lista exacta vs. colección por grupo funcional; "qué carta destraba más listas" = para cada carta faltante, contar listas a las que les falta solo esa.

## 7. Diseño del sync bajo el límite

**Costos.** Por torneo: 1 `standings` (obligatoria) + 1 `details` (opcional; da `decklists`, `phases`, `isOnline`, `bannedCards`, `specialRules` para filtrar). Tamaño: ~1,0-1,1 KB por jugador (425.829 B / 393; 78.858 / 79); con 70 jugadores promedio ≈ 75 KB/torneo crudo, ~8-10 KB gzip; details ≈ 0,5 KB. 60 días ≈ 300 torneos ≈ 22 MB crudos (~3 MB comprimidos): guardar el JSON crudo comprimido (bytea/gzip o archivo) y normalizar a tablas.

**Presupuesto.** 50 req/5 min = 10/min = 600/h = 14.400/día (compartido por IP). Backfill 60 días: 300 standings + 300 details + 2 listados = ~600 llamadas → **60 min al límite, ~75-90 min con margen (8 req/min)**. Sin details: ~35 min. Incremental diario: 1-2 listados + ~5 torneos × 2 = **~12 llamadas/día**; cada hora: 1 listado (`limit=50` cubre ~10 días) y solo los nuevos.

**Algoritmo incremental**
1. `GET /tournaments?game=POCKET&limit=100&page=p` desde p=1; recorrer de más nuevo a más viejo; `upsert tournaments(id, game, format_raw, name, date, players, organizer_id, first_seen, last_seen)`. Cortar cuando una página entera ya es conocida **y** su torneo más viejo tiene `date < now - 2 días` (la lista es por fecha programada, pueden aparecer torneos nuevos "en el pasado" si el organizador los creó tarde; por eso la condición doble). Para backfill, paginar hasta `date < hoy - 60 d`.
2. Candidatos: `status in (new, incomplete)` y `date + 1 día < now` (las horas de inicio muestran que en 24 h terminaron; un torneo de 400 jugadores BO3 dura ~8 h). Prioridad: más nuevo primero; `format_raw in (null, 'NOEX')` antes que `CUSTOM` (o directamente no bajar CUSTOM salvo que se pida).
3. Por candidato: `details` (opcional) → si `decklists:false` o `specialRules`/`bannedCards` no vacíos marcar `excluded_reason` y no bajar standings. `standings` → guardar crudo + hash; si `length == 0` o algún `record` sin partidas, marcar `incomplete` y reintentar en 24 h (máx. 3 veces). Si `players` del listado cambió respecto a la copia guardada, rebajar.
4. Rate limit: token bucket local de **40/300 s** (margen por contadores inconsistentes y por otros procesos de la misma IP, incluido Claude); leer `RateLimit` `r`/`t` y, si `r <= 2`, dormir `t` s; en 429 dormir `max(Retry-After, ratelimit-reset, t, 60 s)`; backoff exponencial con jitter en 5xx/timeout (1, 2, 4, 8 min; abandonar tras 5); `ETag`/`If-None-Match` para los listados (devuelven W/ETag; no verifiqué 304).
5. Idempotencia: `job_runs(id, started, finished, calls_made, tournaments_done)` y `tournaments.sync_status ∈ {listed, excluded, incomplete, complete}`; cada ejecución puede cortarse y retomar.
6. Derivados: al completar un torneo, calcular `era`, `format_effective`, filas `entries(tournament_id, player, placing, drop, wins, losses, ties, deck_id, deck_name, list_key_by_name, list_key_by_functional, energy[])` y `entry_cards(entry_id, card_id, count, functional_group_id)`. Las agregaciones (por arquetipo/lista/era/carta) se recalculan con SQL, no se guardan a mano.
7. Programación: un cron cada 6 h es suficiente (el sitio actualiza a diario). Si en el futuro hubiera key, reemplazar el polling por el webhook `tournament:ended`.

## 8. Prior art (GitHub, verificado con `gh search` y README)

| Repo | Licencia | Qué hace | Reutilizable |
|---|---|---|---|
| `mogja9/ptcgp-tracker` (Next.js 15 + better-sqlite3) | MIT | Tracker autoalojado sobre la API pública: rankings, tier list, matriz de matchups por pairings, inclusión de cartas, standings con listas; criterio de elegibilidad ≥64 jugadores, decklists, sin reglas especiales; `scripts/sync.ts` con `MIN_REQUEST_INTERVAL_MS`, caché SQLite, `isEligible(details)`, `SKIP_PAIRINGS`; `src/lib/limitless.ts` con retry y lectura de `ratelimit-reset`/`retry-after` en 429 | Sí: cliente + esquema de sync (MIT, se puede copiar con atribución) |
| `indren9/ptcgp_ranking` (Python 3.14) | MIT | Ranking MARS con incertidumbre, "latest-completed Standard-set semantics" y catálogo de lanzamientos de Pocket; evidencia cruda hasheada y reproducible | Ideas: catálogo de eras, ranking con shrinkage |
| `PocketDecks/pokemon-tcg-pocket-tier-list` | AGPL-3.0 | Pipeline TS que baja standings+pairings de torneos no procesados, nombra arquetipos scrapeando `/decks` por set (`limitless-decks.json`), Wilson con shrinkage y peso por recencia; docs en `docs/` | Leer la doc de scoring; código AGPL (misma obligación que deckgym) |
| `PocketDecks/pokemon-tcg-pocket-cards` | AGPL-3.0 | 4.317 cartas como JSON versionado en npm, incluye "deck-builder numbers" | Alternativa al tracker, pero AGPL |
| `KevinGutowski/tcgp-deck-qr` | MIT | Lee/crea el QR del juego; importa texto de Limitless; codec documentado | Sí, para exportar un mazo al juego |
| `calerio/pokemon-tcg-pocket-deck-builder` | "Other" | Builder visual con generador/escáner QR en navegador | Referencia |
| `jpbullalayao/limitless-python` / `limitlesstcg-js` / `limitlesstcg-mcp` | MIT | Wrappers finos de los 4 endpoints y un MCP | Poco valor; la API es trivial |
| `aresisgood/PTCG_Pocket_DataBrowser` (FastAPI) | sin licencia | Scraper de cartas y torneos, modelo ML (AUC 0,55) | No |
| `frtpereira/meta-radar`, `ving6/limitless-project`, `Kain7f1/Tourney-Crawler` | varias/sin | Scrapers menores | No |

Sitios que ya hacen esto (no OSS): pokemonmeta.com y trainerhill.com (showcase oficial con key), pokemon-zone.com (tournaments, "updates hourly"), dittobase.com (meta por set).

## 9. Otras observaciones
- El sitio usa alias en URLs (`/tournament/pmpt45/...`) además del id; el id de la API también funciona en el sitio.
- `/tournaments` no expone si hubo decklists; para saberlo sin `details` se puede mirar si el primer standing trae `decklist` (ahorra 1 llamada/torneo).
- Las páginas HTML de decklist incluyen el JSON de la lista en un atributo (`{"pokemon":[...]}` escapado) y el texto; no es necesario scrapear, la API da lo mismo.
- Limitless usa `Open Sans`/`Anton` y Google Analytics; irrelevante.


## Recomendaciones
1. **Formato efectivo = `format ?? 'STANDARD'`; excluir `CUSTOM`.** Guardar `format_raw` y calcular `era` por fecha con una tabla editable de sets (`code, name, release_date, opens_era bool`; A4b/B4b con `opens_era=false`). Mostrar siempre "era B4a (desde 27/8/2026)" con n torneos y n listas. Umbral de inclusión sugerido: `players >= 12` y `decklists:true` (reproduce 154 torneos de Limitless para B4a); hacerlo configurable (brief: ≥16).
2. **Sync**: una sola llamada por torneo (`standings`); `details` solo si se quiere `phases`/`specialRules` (yo lo haría, cuesta 0,5 KB y permite excluir bans). Token bucket 40/300 s, dormir con `t` del header, 429 → `Retry-After`. Backfill inicial de 60 días en ~1,5 h en segundo plano con reanudación. Guardar JSON crudo gzip + tablas normalizadas; recomputar agregados en SQL.
3. **Identidad de lista**: dos claves, `by_name` (lo que pide el brief) y `by_functional_group` (más correcta ante homónimos). Para arquetipos, guardar `deck_id/name/icons` tal cual y una tabla de alias propia para fusionar variantes; no asumir estabilidad del slug.
4. **Estadística**: `WR = W/(W+L+T)` con `n = W+L+T`, Wilson 95%, marcar `<30 listas` como orientativo, mostrar la media de la era al lado; nunca mezclar con partidas propias ni simulaciones.
5. **Import/export de mazos (M3)**: implementar el formato "Limitless clipboard" (`<count> <name> <SET> <NUMBER>` + `Energy:`), que es a la vez el formato de deckgym; soportar también encabezados `Pokémon:`/`Trainer:` y números con ceros al importar. El string `?i=` del builder se puede generar (decodificación en §4a) para abrir una lista en my.limitlesstcg.com. Dejar el QR del juego para "más adelante" con `tcgp-deck-qr` (MIT) si se consigue el mapa de entity IDs.
6. **Español**: no hay texto de cartas en español utilizable hoy; mantener inglés de Limitless con nombres del tracker. Reevaluar TCGdex cuando cubra B-series.
7. **Prior art**: tomar de `mogja9/ptcgp-tracker` (MIT) el cliente con reintentos y el criterio de elegibilidad; leer `docs/explanation/statistical-scoring.md` de PocketDecks solo como referencia (AGPL). Anotar en `docs/LICENCIAS.md`.
8. **Atribución**: pie "Datos de torneo: Limitless" con enlace; no pedir API key (no se otorgan a proyectos privados).
9. Para M6, el autocompletado de arquetipos rivales puede salir de los `deck.name` distintos de la era vigente (128 en un solo torneo de 393; conviene limitar a los que tienen ≥N listas).

## Riesgos
- **Rate limit compartido y contadores inconsistentes** (impacto: 429 durante análisis manuales o el backfill). Mitigación: bucket local 40/5 min, respetar `t`/`Retry-After`, backfill reanudable, un solo proceso de sync; no usar la API desde chats mientras corre.
- **Cambio silencioso de arquetipos** (`deck.id` puede renombrarse o desaparecer; sin key no tenemos las reglas). Mitigación: guardar lo recibido por standing + tabla de alias propia; estadísticas por lista exacta no dependen de esto.
- **Torneos sin `format`** (Standard = null; si Limitless empieza a rellenarlo o agrega formatos, el filtro cambia). Mitigación: `format_raw` guardado, regla `null → STANDARD` en una función única con test; alerta si aparece un valor desconocido.
- **Cambio de era mal detectado** (nuevo set cada ~30 días; Deluxe no abre era). Mitigación: tabla de sets editable + control cruzado "set más nuevo en las listas"; aviso en la UI cuando la fecha actual supera la última release conocida + 35 días.
- **Datos nulos/raros**: `placing` null en abandonos, `energy` ausente, `decklist`/`deck` null posibles, byes que desbalancean W/L. Mitigación: columnas nullable, tests con los dos JSON reales guardados en el scratchpad, media de la era como baseline.
- **Mapeo de cartas**: hoy 100% de set-number mapea al tracker, pero un set nuevo aparece en Limitless antes que en `cards.json`. Mitigación: cola de "cartas desconocidas" con nombre/set/number y re-mapeo al sincronizar el catálogo.
- **Licencias**: código de PocketDecks y deckgym son AGPL; copiar lógica de ahí obliga a publicar si la app se abre. Mitigación: preferir ptcgp-tracker (MIT) o reimplementar; registrar en `docs/LICENCIAS.md`.
- **Términos de uso de Limitless** no leídos en detalle (tos/legal). Mitigación: uso personal, volumen bajo, atribución visible; revisar antes de compartir la app.
- **deckgym panics** con energía desconocida (`expect`) y con `Energy:` vacío → el worker debe validar el texto antes de invocar el binario.

## Preguntas abiertas
1. ¿Umbral mínimo de jugadores para contar un torneo: 12 (reproduce los 154 torneos que muestra Limitless para B4a), 16 (tu análisis previo) o 64 (criterio de ptcgp-tracker)? Propongo 12 configurable.
2. ¿Querés incluir los torneos `NOEX` como "formato" aparte en la UI, o solo Standard? (Hay ~2-3 por mes.)
3. ¿Bajar también `pairings` (duplica llamadas) para matchups arquetipo vs arquetipo, o alcanza con récord por lista/arquetipo en Fase 3 y pairings queda para después?
4. ¿Cuántos días de backfill inicial: 60 (≈300 torneos, 1,5 h) o desde el inicio de la era B4 (30/7, ≈110 torneos más)?
5. Para "lista exacta": ¿por nombre (brief) o por grupo funcional (distingue Riolu A2-91 de B3-79)? Propongo mostrar por grupo funcional y aclarar la diferencia.
6. ¿Tenés cuenta en my.limitlesstcg.com? Si sí, ¿podés copiar el texto que exporta su builder para Pocket para confirmar que coincide con el del botón "Copy to Clipboard"?
7. ¿Querés exportar al QR del juego en alguna fase? Requiere la base comunitaria de entity IDs (tcgp-deck-qr); si no, lo dejo fuera.
8. ¿Es aceptable que el texto de ataques/habilidades quede en inglés (Limitless) hasta que exista una fuente en español confiable?

## Fuentes
**Archivos locales (rutas absolutas)**
- `C:\Users\<usuario>\Personal\tcg pocket\Docs\BRIEF.md` (§3.3 líneas 104-110; M5 líneas 177-182)
- `C:\Users\<usuario>\Personal\tcg pocket\Docs\context\guia_del_proyecto.md:47-68` (fuentes y método de torneo)
- `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core\src\deck.rs:43-96` (parser), `:161-181` (`from_str_with_count`, padding línea 173), `:281-298` (test con encabezados `Pokémon:`/`Trainer:`)
- `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core\src\models\card.rs:39-53` (`EnergyType::from_str`)
- `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core\src\card_ids.rs:8428-8432` (P-A), `:8652` (`from_card_id`); 103 ids P-B, 429 ids B4b
- `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core\README.md:15` (Share > Copy as Text), `example_decks\mega-absol-hydreigon.txt`, `example_decks\venusaur-exeggutor.txt`
- `C:\Users\<usuario>\Personal\tcg pocket\refs\tracker\frontend\assets\cards.json` (card_id, name, internal_id, alternate_versions), `pokemon_translations.json`
- Scratchpad: `C:\Users\<usuario>\AppData\Local\Temp\claude\C--Users-<usuario>-Personal-tcg-pocket\744b015a-5491-4593-b20b-d31f39f97693\scratchpad\api\{t1,t2,noex_standings,big_standings,big_details,games,decks_nokey,fmt_noex,fmt_std,lim500}.json` y `*.headers`; `analyze.js`; `scratchpad\web\{decks,decks_B4,decks_B3b,decks_B4a,tour,standings,decklist,card,card_es,pocket_cards,pocket_home,mybuilder,tcgdex*}.html/json`; `scratchpad\docs\developer*.html`

**Web**
- https://docs.limitlesstcg.com/developer.html, /developer/tournaments.html, /developer/games.html, /developer/webhooks.html
- https://play.limitlesstcg.com/api/tournaments?game=POCKET&limit=200 (+page=2, limit=500&page=3, format=NOEX, format=STANDARD); /api/tournaments/6a9ebbfcab080c8c957fcc9a/standings; /api/tournaments/6a95b87b629039f77d8a6954/standings y /details; /api/games; /api/games/POCKET/decks
- https://play.limitlesstcg.com/decks?game=POCKET (y &format=standard&set=B4 / B3b / B4a); https://play.limitlesstcg.com/tournament/6a95b87b629039f77d8a6954/standings; https://play.limitlesstcg.com/tournament/pmpt45/player/<jugador>/decklist
- https://pocket.limitlesstcg.com/cards (tabla de sets con fechas), /cards/B2/113, /cards/B2/113?lang=es, /es/cards/B2/113 (404)
- https://my.limitlesstcg.com/builder?game=pocket
- https://api.tcgdex.net/v2/es/series/tcgp, /v2/es/cards/A1-001, /v2/es/sets/B2, /v2/en/series/tcgp
- https://www.serebii.net/news/2026/29-July-2026.shtml (códigos 2D de mazo)
- https://github.com/mogja9/ptcgp-tracker (README, `src/lib/limitless.ts`, `scripts/sync.ts`), https://github.com/indren9/ptcgp_ranking, https://github.com/PocketDecks/pokemon-tcg-pocket-tier-list (`docs/reference/analysis-pipeline.md`), https://github.com/PocketDecks/pokemon-tcg-pocket-cards, https://github.com/KevinGutowski/tcgp-deck-qr (README, `docs/format.md`), https://github.com/flibustier/pokemon-tcg-pocket-database, https://github.com/aresisgood/PTCG_Pocket_DataBrowser, https://github.com/jpbullalayao/limitless-python
- Intentados sin éxito: https://bulbapedia.bulbagarden.net/wiki/B_Series_(TCG_Pocket) y A_Series (403), https://www.deckgym.com/builder (connection reset), https://ptcgpocket.gg/series/ (solo hasta A3), https://www.serebii.net/tcgpocket/ (sin fechas)

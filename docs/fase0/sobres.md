> Informe de investigación automático de la Fase 0 (6/10/2026), generado por agentes de Claude Code sobre `refs/tracker` @ 3ab58f1, `refs/deckgym-core` @ fb792ebf, la API de Limitless y documentación pública. Las rutas `C:\Users\<usuario>\AppData\Local\Temp\...` son scripts descartables de la sesión. Los números de colección se calcularon con la exportación del 1/10/2026 que estaba en Descargas; el plan usa la del 6/10/2026 en `docs/context/`. Las secciones "Preguntas abiertas" quedaron consolidadas en `docs/PLAN.md` §8.

# packs

## Resumen
Revisé stats.ts (commit 3ab58f1) línea por línea, lo copié literal al scratchpad y lo ejecuté con node 24 (strip-types) contra un port limpio en JS: diferencia máxima 0 en los 29 sobres × 3 filtros sobre tu CSV real (4317 filas, 3866 InternalId únicos, 0 duplicados con conteos distintos). No había trabajo previo del modelo anterior sobre este tema en el scratchpad (los archivos que hay ahí son de otros investigadores).

Resultados clave: todas las tablas por posición suman 100.000 salvo DELUXE.position3 = 99.999 (igual que la tabla oficial redondeada). Las tasas del sobre común, del sobre con shinies, del sobre de 6 cartas (8.33 %, 87.1/12.9) y de los Deluxe (4 cartas, 4.ª = ◊◊◊◊ 100 %) coinciden con las fuentes oficiales/comunitarias. Aproximaciones del tracker: rare pack uniforme por carta (oficial pondera por rareza; efecto ≤ 0.05 pp), Deluxe sin rare pack (oficial 0.050 %, uniforme 1/26), y dos bugs reales: (1) en sets con containsBabies=false pero cartas baby (B1, B2, B3, B4, B4a, B4b) el denominador excluye las babies y la masa por rareza suma 107–125 % de la tabla; (2) en deckbuildingMode el prefiltro `c.expansion === expansion.id` (stats.ts:126) descarta reimpresiones funcionales de otra expansión: en 18–22 sobres cambia la cantidad de cartas buscadas (ej. B1 megaaltaria 24→30, 59.74 %→61.03 %).

Fixtures golden (filtro a / b / c): A3 solgaleopack 78.0258 / 64.9361 / 99.3304 % es el mejor sobre abrible en los tres casos; A4b deluxepack 96.5871 / 60.0172 / 94.4459 %; B4b deluxepackmega 77.3904 / 19.1438 / 59.0412 %. P-A/P-B lanzan error (sin packStructure). craftingCost no tiene ✵/✵✵ (oficial: 1000/1350, sin verificar en juego) ni 'P'; tradableRarities del tracker incluye ☆☆/✵/✵✵ que según las fuentes de 2025 el juego no intercambia (pendiente de confirmar a oct-2026). Propongo un esquema de peso por copia faltante y mostrar P(≥1), valor esperado ponderado y sobres necesarios (geométrica; para "todas" inclusión–exclusión o Monte Carlo).

## Hallazgos
# M4 · Modelo de probabilidad de sobres del tracker (stats.ts) — análisis completo

Commit analizado: `refs/tracker @ 3ab58f1`. Todas las rutas son relativas a `C:\Users\<usuario>\Personal\tcg pocket\refs\tracker\`. Scripts descartables (NO código de app) en `C:\Users\<usuario>\AppData\Local\Temp\claude\C--Users-<usuario>-Personal-tcg-pocket\744b015a-5491-4593-b20b-d31f39f97693\scratchpad\`: `cardsdb-shim.mjs`, `stats-verbatim.ts` (copia literal de stats.ts con un solo import cambiado), `port.mjs` (port limpio), `runner.mjs` (comparación + fixtures), `crossexp.mjs`, `linked.mjs`, `runner-output.txt`.

Nota sobre "lo que hizo el modelo anterior": el scratchpad no tenía nada sobre este tema. Los archivos `analyze.mjs`, `card_status.js`, `ids_compare.js`, `api/`, `web/` que aparecieron durante la sesión son de otros investigadores del workflow (catálogo, deckgym, limitless); no los toqué.

---

## 1. El modelo línea por línea

### 1.1 Tablas de rareza por posición (porcentajes) — `stats.ts:24-83`

`createRarityProbability` (`stats.ts:8-21`) completa con 0 las 11 rarezas (`types/index.ts:33`: ◊, ◊◊, ◊◊◊, ◊◊◊◊, ☆, ☆☆, ☆☆☆, ✵, ✵✵, Crown Rare, P).

**Sobre común de 5 cartas** (`standardPackProbabilities`):

| Posición | ◊ | ◊◊ | ◊◊◊ | ◊◊◊◊ | ☆ | ☆☆ | ☆☆☆ | ✵ | ✵✵ | Crown | Suma |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1–3 (`:25`) | 100 | | | | | | | | | | 100.000 |
| 4 (`:26-34`) | | 90 | 5 | 1.666 | 2.572 | 0.5 | 0.222 | | | 0.04 | 100.000 |
| 5 (`:35-43`) | | 60 | 20 | 6.664 | 10.288 | 2 | 0.888 | | | 0.16 | 100.000 |
| 4 shiny (`:44-54`) | | 89 | 4.9525 | 1.666 | 2.572 | 0.5 | 0.222 | 0.71425 | 0.33325 | 0.04 | 100.000 |
| 5 shiny (`:55-65`) | | 56 | 19.81 | 6.664 | 10.288 | 2 | 0.888 | 2.857 | 1.333 | 0.16 | 100.000 |

**Sobre Deluxe de 4 cartas** (`deluxePackProbabilities`, `:69-83`):

| Posición | ◊ | ◊◊ | ◊◊◊ | ◊◊◊◊ | ☆ | ☆☆ | ☆☆☆ | ✵✵ | Crown | Suma |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 (`:70`) | 100 | | | | | | | | | 100.000 |
| 2 (`:71`) | 17.73 | 82.27 | | | | | | | | 100.000 |
| 3 (`:72-81`) | 23.021 | 17.985 | 40.659 | | 12.858 | 2.5 | 1.111 | 1.667 | 0.198 | **99.999** |
| 4 (`:82`) | | | | 100 | | | | | | 100.000 |

Sumas calculadas con aritmética entera en milésimas (`runner.mjs`, sección 0). **Única desviación: Deluxe posición 3 = 99.999 (−0.001)**, heredada de la tabla oficial redondeada a 3 decimales. No hay ✵ (1-shiny) en el Deluxe: coherente con el catálogo (A4b y B4b tienen 0 cartas ✵ y 2 ✵✵ cada uno).

Otras constantes:
- `abilityByRarityToBeInRarePack` (`:85-92`): ☆, ☆☆, ☆☆☆, ✵, ✵✵, Crown = 1 (elegibles para rare pack); ◊-tipo y P = 0.
- `probabilityPerRarityBaby` (`:94-97`): ◊◊◊ 87.1, ☆ 12.9 (suma 100.000) para la 6.ª carta del sobre "baby".
- Mezcla de tipos de sobre (`:240-247`): sin babies 0.9995 + 0.0005 = 1; con babies 0.9162 + 0.0005 + 0.0833 = 1.0000.

### 1.2 Selección de tabla — `getPositionProbability` (`:99-118`)
- `cardsPerPack === 4` → `deluxePackProbabilities[position{n}]`, fallback a `positions1to3` (nunca se usa).
- 5 cartas: pos 1–3 → `positions1to3`; pos 4/5 → variante `Shiny` si `structure.containsShinies` (`CardsDB.ts` packStructure por expansión: A1, A1a, A2, A2a sin shinies; A2b en adelante con shinies; babies solo A4 y A4a; Deluxe A4b/B4b `cardsPerPack: 4`, `containsLinkedCards: true`, `openable: false` en `CardsDB.ts:196` y `:355`).

### 1.3 `pullRate` (`:120-131`) y "everypack"
`cardsInPack = cartas de la expansión con c.pack === pack.name || c.pack === 'everypack'`. Las cartas buscadas se prefiltran con `c.expansion === expansion.id` (`:126`, ver bug 1.9).

Dato del catálogo (`cards.json`): en A1 cada sobre tiene 79/80/80 cartas propias + 47 `everypack` = 126/127/127. En las expansiones de un solo sobre desde A2b (A2b, A3a, A3b, A4a, A4b, B1a, B2…B4b) **todas** las cartas tienen `pack: 'everypack'` y el nombre del sobre en `CardsDB.ts` (p. ej. `shiningrevelrypack`) no aparece en ninguna carta: el match ocurre solo por `'everypack'`. En A1a/A2a sí llevan `mewpack`/`arceuspack`. Nuestra app no puede indexar por `card.pack === pack.name` solamente.

### 1.4 `pullRateForCardSubset` (`:174-251`), el núcleo
1. `cardsInRarePack` = cartas del sobre con rareza elegible (`:175`).
2. `missingCardsFromPack` (`:177-180`): con `deckbuildingMode=false` match exacto por `internal_id`; con `true`, cualquier carta del sobre cuyo `alternate_versions` contenga un id buscado (todas las ediciones de la carta funcional cuentan).
3. Por carta buscada (`:185-225`): si `rarity === 'P'` se saltea (`:188`; las promo nunca salen de sobres). `rarityList = [card.rarity]` (vestigio: siempre 1 elemento).
   - **Rama baby** (`:197-201`): si `card.baby && rarity !== 'Crown Rare' && structure.containsBabies`, la carta **solo** puede salir en la 6.ª posición: `chanceBaby += BABY[rarity]/100 / k_baby`, con `k_baby` = cartas baby de esa rareza en el sobre. Sus posiciones 1–5 quedan en 0.
   - **Rama normal** (`:203-215`): `k = #cartas del sobre con esa rareza y (Crown Rare || !baby)`; para cada posición `p_pos += tabla[pos][rarity]/100 / k`; además si 5 cartas, `rare += elegible / |cardsInRarePack|` (uniforme por carta, no por rareza).
4. Agregación (`:220-224`): se suman por posición las probabilidades de todas las cartas buscadas (eventos disjuntos dentro de una posición → suma exacta).
5. `chanceToGetInStandardPack = ∏_pos (1 − Σ_pos)` (`:228`) = P(ninguna buscada en 5 posiciones) **asumiendo independencia entre posiciones** y permitiendo repetidas dentro del sobre.
6. Resultado (`:231-250`):
   - 4 cartas: `1 − pNone` (sin rare ni baby pack).
   - 5 cartas sin babies: `0.9995·(1 − pNone) + 0.0005·(1 − (1 − r)^5)` con `r = Σ rare` (rare pack = 5 extracciones i.i.d. uniformes entre las elegibles).
   - 5 cartas con babies: `0.9162·(1 − pNone) + 0.0005·(1 − (1 − r)^5) + 0.0833·(1 − pNone·(1 − b))`, con `b = Σ chanceBaby` (sobre de 6 = las 5 posiciones normales + 1 slot baby independiente).
   La suma es una unión disjunta correcta porque los tres tipos de sobre son mutuamente excluyentes.

### 1.5 Otras funciones
- `pullRateForSpecificCard` (`:133-140`): una sola carta, `deckbuildingMode=false`, `×100`; si la carta es `everypack` usa `packs[0]` (`:137`). Es lo que muestra `CardDetail.tsx:236-238` ("chanceToPull").
- `pullRateForSpecificMission` (`:142-172`): mismas fórmulas para las cartas faltantes de una misión, por cada sobre de la expansión.

### 1.6 Verificación del modelo contra el juego (resumen; detalle en §6)
Posición 4 del Deluxe "◊◊◊◊: 100": en A4b las 75 ◊◊◊◊ son todas ex (0 no-ex) y en B4b las 70 también; además todas son reimpresiones con id compartido. Oficialmente la 4.ª carta es "4 Diamond 100 %": coherente. Con una carta ◊◊◊◊ buscada, p = 1/75 = 1.333 % (A4b) o 1/70 = 1.429 % (B4b) por sobre.

### 1.7 Aproximaciones (no bugs)
- **Rare pack uniforme por carta** (`:214`): el juego pondera por rareza (A1: ☆ 40 / ☆☆ 50 / ☆☆☆ 5 / Crown 5 %; sets con shinies p. ej. ☆ 28.571 / ☆☆ 33.333 / ☆☆☆ 2.38 / ✵ 23.809 / ✵✵ 9.523 / Crown 2.38 %). Como el rare pack pesa 0.0005, el error absoluto máximo es 0.05 pp.
- **Deluxe sin rare pack**: el juego tiene 0.050 % de rare pack en Deluxe ex (4 cartas, uniforme 1/26 por carta: Crown 3.846, ✵✵ 7.692, ☆☆☆ 3.846, ☆ 23.076, ☆☆ 61.538 %). El tracker trata el 100 % como sobre regular: sobreestima cada p regular por 1/0.9995 e ignora el rare pack. Efecto < 0.05 pp.
- **Shinies en rare pack**: el tracker los incluye como elegibles; el juego también (✵ 5 %, ✵✵ 2 % según una fuente; game8 da otros números). OK en estructura.
- **Independencia entre posiciones y repetidas dentro del sobre**: aproximación estándar; sin datos oficiales para hacer algo mejor.
- **Babies solo en el slot 6**: para A4/A4a las babies ◊◊◊/☆ tienen 0 en posiciones 1–5. Coincide con que la tasa oficial por carta del 6.º slot es 29.033 % = 87.1/3 (3 babies ◊◊◊ por sobre) y 12.9 % para la ☆ baby (Magby ☆ A4-166 en ho-ohpack, Pichu ☆ A4-171 en lugiapack). No pude confirmar si además aparecen en posiciones 4/5 (pregunta abierta).
- **Crown Rare baby** (A4a-105 Mantyke): rama normal, `k = 1` → 0.04 % + 0.16 % + rare 1/34 → 0.20677 % (fixture).

### 1.8 Bug real 1: denominadores que excluyen babies en sets con `containsBabies: false`
`:204` cuenta `k` excluyendo `baby` siempre, pero la rama baby (`:197`) solo se activa si `containsBabies`. En B1, B2, B3, B4, B4a y B4b hay cartas con `baby: true` (detección heurística del scraper, `scripts/scraper.ts:373`: `weakness === 'none' && hp === 30 && energy !== 'dragon'`) y estructura sin babies, así que esas cartas usan las tablas normales con un `k` menor al real; la masa de probabilidad por rareza queda > 100 % de la tabla:

| Sobre | Rareza | Cartas | k usado | Σ p por rareza vs tabla |
|---|---|---|---|---|
| B1 (3 sobres) | ◊◊◊ | 15 | 14 | 107.14 % |
| B2 megagardevoirpack | ✵ | 20 | 16 | 125.00 % |
| B3 pulsingaurapack | ◊◊◊ / ☆ | 29 / 24 | 27 / 22 | 107.41 % / 109.09 % |
| B4 ruleroftheskiespack | ◊◊◊ / ☆ | 28 / 24 | 26 / 23 | 107.69 % / 104.35 % |
| B4a teamrocketsambitionpack | ◊◊◊ / ☆ | 8 / 6 | 7 / 5 | 114.29 % / 120.00 % |
| B4b deluxepackmega | ◊◊◊ | 60 | 52 | 115.38 % |

Fixture: B1-109 (◊◊◊ baby) en megablazikenpack → perPos [0,0,0,0.35375,1.415] = 4.9525/14 y 19.81/14 (debería ser /15). Corrección propuesta: `k` excluye babies **solo si** `structure.containsBabies`.

### 1.9 Bug real 2: prefiltro por expansión en deckbuildingMode (`stats.ts:126`)
En deckbuildingMode las cartas buscadas son solo la "edición base" (`internal_id === alternate_versions[0]`, `filters.ts:79`). `pullRate` filtra `wantedCards` por `c.expansion === expansion.id` **antes** de matchear por `alternate_versions`, así que una reimpresión funcional en otra expansión con id propio (426 cartas cuyo `alternate_versions[0]` no está en su expansión; p. ej. A3-210 Bulbasaur ✵ con base A1-1) nunca cuenta. Impacto sobre tu CSV (`crossexp.mjs`):

Filtro (b) — todas las rarezas, number=1, deckbuilding: cambia en 18 sobres. Ejemplos: A3 lunalapack 36→40 cartas, 63.84→64.71 %; A4 lugiapack 26→31, 46.30→47.65 %; B1 megaaltariapack 24→30, 59.74→61.03 %; B4a 16→18, 19.45→20.13 %.

Filtro (c) — ◊..◊◊◊◊, number=2, deckbuilding: cambia en 22 sobres. Ejemplos: A3 lunalapack 65→74, 94.34→94.86 %; B1 megagyaradospack 50→60, 87.10→88.03 %; B3 pulsingaurapack 84→94, 90.07→90.42 %.

Para el filtro (a) (match exacto) no hay diferencia por construcción. Nuestra app debería matchear contra el conjunto buscado completo (y ofrecer un modo "compatible con tracker" solo para el test de aceptación).

### 1.10 `containsLinkedCards` (lo que pide el brief)
`scripts/scraper.ts:382-402`: con `containsLinkedCards: true`, una carta de rareza ◊-tipo cuya tabla de versiones en Limitless lista una versión anterior con la misma rareza en otro set recibe el `internal_id` **del original** (`baseCardNr` del original, `encode(baseExpansion, …)`). Resultado (`linked.mjs`): A4b 379 cartas = 214 con id compartido (◊ 64, ◊◊ 50, ◊◊◊ 25, ◊◊◊◊ 75; apuntan a A1…A3b) + 165 con id propio (◊ 64, ◊◊ 50, ◊◊◊ 25 = artes alternativos/foil de las mismas cartas, p. ej. A4b-2 Bulbasaur ◊; más ☆ 6, ☆☆ 16, ☆☆☆ 1, ✵✵ 2, Crown 1). B4b 429 = 236 compartidas (71/65/30/70; apuntan a B1…B3b) + 193 propias. Para el modelo: las 128 ◊ de A4b cuentan todas en `k` (1/128 cada una); para la colección, la fila A4b-1 repite la cantidad de A1-1 (por eso el CSV se deduplica por InternalId). Efecto colateral del scraper con `containsLinkedCards: false` (`:399-400`): `baseExpansion` igual se cambia pero no el número → 2 ids "huérfanos" en espacio ajeno: B2a-89 Iono (id 333377 codifica A2b#89) y B2a-92 Penny (530177 → A3b#92). Sin colisión hoy; vale anotarlo para M1.

---

## 2. Qué calcula exactamente la pantalla Overview

- Estado de filtros (`Overview.tsx:48-51`): `{ rarity: Rarity[], number: 1..5, deckbuildingMode }`, persistido en `localStorage['overview-filters']`; default `{ rarity: [], number: 1, deckbuildingMode: false }`.
- `RarityFilter.tsx:13-21`: con deckbuildingMode las opciones se limitan a ◊, ◊◊, ◊◊◊, ◊◊◊◊, P y se borran las ☆ seleccionadas.
- Tres listas (`Overview.tsx:64-66`): `availableCards = getFilteredCards(filters)`; `collectedCards = … minNumber: number`; `wantedCards = … maxNumber: number − 1` (es decir, `amount_owned ≤ number − 1`). La clave `number` dentro del objeto es ignorada por `getFilteredCards`.
- `getFilteredCards` (`filters.ts:75-185`) para esos filtros: (1) deckbuildingMode → solo `internal_id === alternate_versions[0]` (`:79`; conserva A1-1 y A4b-1 porque comparten id); (2) filtro de rareza (`:99-102`); (3) `amount_owned` = suma sobre `alternate_versions` en deckbuilding (`:155-158`) o exacto (`:160`); `collected` del row (`:164`); (4) `minNumber`/`maxNumber` (`:168-175`). **No filtra por expansión ni por `openable`**: `wantedCards` incluye cartas P-A/P-B (rareza P, salteadas en stats) y A4b/B4b (nunca evaluadas).
- Mejor sobre (`Overview.tsx:68-86`): `expansions.filter(openable)` (`:70`) → por expansión, `packs.filter(name !== 'everypack')` (`:73`) → `pullRate(wantedCards, expansion, pack, deckbuildingMode)` (`:76`) → ordena desc y toma el primero (`:79`) → se queda con el máximo global (`:80-82`). Tabla (`:159-228`): `expansions.toReversed().filter(openable)`; expansión de un solo sobre muestra `pullRate(packs[0])` (`:185-189`); multi-sobre una fila por sobre salvo `everypack` (`:213-221`). Colores: ≥10 % verde, ≥3 % amarillo (`:188`). Se muestra con `toFixed(1)`.
- **Por qué A4b/B4b no aparecen**: `openable: false` (`CardsDB.ts:196`, `:355`) los excluye en `:70` y `:161`. `pullRate` funciona perfectamente para ellos (fixtures abajo). P-A/P-B: `openable: false` y sin `packStructure` → `pullRate` lanza `"P-A: can't calculate probability without 'packStructure' field"` (`stats.ts:122`).
- Qué hacer distinto en nuestra app: iterar todas las expansiones con `packStructure`; interruptor "disponible" por sobre (brief) en vez de `openable` hardcodeado; matchear sobres por `card.pack ∈ {name, 'everypack'}`; en modo mazos no prefiltrar por expansión (§1.9); corregir denominadores (§1.8) de forma configurable; mostrar también E[cartas buscadas] y sobres necesarios.

---

## 3. Fixtures golden (CSV del 1/10/2026, cards.json @ 3ab58f1)

CSV: 4317 filas, 3866 `InternalId` únicos, 0 duplicados con `NumberOwned` distinto, 100 % de ids presentes en cards.json y viceversa; 2045 ids con ≥1 copia. Importador del tracker: `amount_owned = max(0, NumberOwned)`, `collected = Collected` (`ImportReader.tsx:26-27`).

Filtros: **(a)** rarity=[], number=1, deckbuilding=false → 1900 cartas buscadas (1821 ids únicos). **(b)** rarity=[], number=1, deckbuilding=true → 535 (476). **(c)** rarity=[◊,◊◊,◊◊◊,◊◊◊◊], number=2, deckbuilding=true → 1196 (1035).

`p_x` = P(al menos una buscada) en %, `E_x` = cartas buscadas esperadas por sobre (mezcla de tipos de sobre, ver §4), `n_x` = cartas del sobre que matchean (incluye rareza P si hubiera; aquí ninguna). `max |stats.ts literal − port| = 0`.

| Exp | Sobre | openable | p_a | E_a | n_a | p_b | E_b | n_b | p_c | E_c | n_c |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | mewtwopack | sí | 43.3675 | 0.5127 | 32 | 31.5445 | 0.3575 | 15 | 67.9893 | 0.9833 | 40 |
| A1 | charizardpack | sí | 69.2133 | 1.0119 | 44 | 61.7841 | 0.8509 | 30 | 90.9466 | 1.8509 | 58 |
| A1 | pikachupack | sí | 45.9081 | 0.5597 | 34 | 37.7451 | 0.4380 | 20 | 72.7002 | 1.0880 | 40 |
| A1a | mewpack | sí | 63.4812 | 0.8960 | 30 | 57.6608 | 0.7849 | 20 | 94.6544 | 2.2059 | 45 |
| A2 | dialgapack | sí | 53.4286 | 0.6519 | 38 | 47.5151 | 0.5670 | 26 | 91.4331 | 1.8808 | 63 |
| A2 | palkiapack | sí | 42.1176 | 0.4919 | 31 | 30.4218 | 0.3412 | 15 | 76.0263 | 1.1886 | 39 |
| A2a | arceuspack | sí | 22.6764 | 0.2370 | 25 | 13.4415 | 0.1376 | 11 | 75.3522 | 1.1646 | 33 |
| A2b | shiningrevelrypack | sí | 12.2429 | 0.1261 | 32 | 5.1374 | 0.0520 | 12 | 12.5288 | 0.1283 | 20 |
| A3 | lunalapack | sí | 71.8470 | 1.0143 | 63 | 63.8400 | 0.8653 | 36 | 94.3409 | 2.0504 | 65 |
| A3 | solgaleopack | sí | **78.0258** | 1.2540 | 68 | **64.9361** | 0.9332 | 27 | **99.3304** | 3.0715 | 89 |
| A3a | buzzwolepack | sí | 46.5096 | 0.5294 | 41 | 31.0003 | 0.3381 | 18 | 93.0424 | 2.0110 | 46 |
| A3b | eeveegrovepack | sí | 60.7371 | 0.7994 | 47 | 46.0582 | 0.5678 | 21 | 94.6863 | 2.1641 | 48 |
| A4 | ho-ohpack | sí | 73.8148 | 1.1392 | 58 | 64.8122 | 0.9220 | 28 | 88.4562 | 1.6512 | 53 |
| A4 | lugiapack | sí | 58.4452 | 0.7677 | 52 | 46.3000 | 0.5631 | 26 | 87.9600 | 1.6550 | 60 |
| A4a | suicunepack | sí | 51.8136 | 0.6445 | 40 | 40.6982 | 0.4827 | 14 | 89.8193 | 1.6790 | 42 |
| **A4b** | deluxepack | no | **96.5871** | 2.2714 | 223 | 60.0172 | 0.7612 | 69 | 94.4459 | 1.9516 | 182 |
| B1 | megaaltariapack | sí | 67.5724 | 0.9787 | 53 | 59.7436 | 0.8228 | 24 | 91.6860 | 1.9558 | 51 |
| B1 | megablazikenpack | sí | 58.2745 | 0.7720 | 47 | 49.3131 | 0.6263 | 21 | 85.3403 | 1.5660 | 47 |
| B1 | megagyaradospack | sí | 57.2880 | 0.7253 | 50 | 47.5864 | 0.5801 | 22 | 87.0983 | 1.6199 | 50 |
| B1a | crimsonblazepack | sí | 58.7984 | 0.7416 | 40 | 50.6140 | 0.6183 | 17 | 97.4778 | 2.5879 | 44 |
| B2 | megagardevoirpack | sí | 67.3195 | 0.9201 | 107 | 57.8545 | 0.7553 | 45 | 94.1034 | 2.1344 | 95 |
| B2a | paldeanwonderspack | sí | 72.4020 | 1.0806 | 56 | 59.7950 | 0.8222 | 21 | 96.9973 | 2.3510 | 67 |
| B2b | megashinepack | sí | 62.7410 | 0.8123 | 57 | 54.3304 | 0.6755 | 20 | 93.6418 | 2.0734 | 47 |
| B3 | pulsingaurapack | sí | 63.6079 | 0.8681 | 97 | 48.0924 | 0.5996 | 33 | 90.0656 | 1.8179 | 84 |
| B3a | paradoxdrivepack | sí | 61.6483 | 0.7609 | 46 | 53.1110 | 0.6305 | 16 | 97.9912 | 2.5944 | 51 |
| B3b | everydaywonderspack | sí | 47.6255 | 0.5504 | 43 | 30.0593 | 0.3273 | 9 | 78.4178 | 1.2153 | 31 |
| B4 | ruleroftheskiespack | sí | 64.8331 | 0.8989 | 104 | 53.2312 | 0.6874 | 42 | 87.6058 | 1.6700 | 89 |
| B4a | teamrocketsambitionpack | sí | 35.3323 | 0.3777 | 42 | 19.4539 | 0.2012 | 16 | 90.4955 | 1.7571 | 49 |
| **B4b** | deluxepackmega | no | 77.3904 | 1.2080 | 144 | 19.1438 | 0.2014 | 19 | 59.0412 | 0.7658 | 79 |
| P-A | everypack | no | error: sin packStructure | | | | | | | | |
| P-B | everypack | no | error: sin packStructure | | | | | | | | |

Mejor sobre según el tracker (solo openable): (a) A3/solgaleopack 78.0258 %; (b) A3/solgaleopack 64.9361 %; (c) A3/solgaleopack 99.3304 %. Incluyendo Deluxe: (a) **A4b/deluxepack 96.5871 %** (el Deluxe ex gana), (b) y (c) sigue A3/solgaleopack. El tracker muestra 1 decimal: el test "coincide con el tracker" debe comparar con `toFixed(1)` de estos valores. Ojo: la web del tracker puede tener un `cards.json` más nuevo que 3ab58f1; los fixtures están atados a ese commit + este CSV.

JSON de fixtures (mismos números): ver `runner-output.txt` en el scratchpad (sección "JSON fixtures").

**Fixtures por carta** (`pullRateForSpecificCard`, %, literal = port):

| Carta | Sobre | p (%) | perPos (%) | rare (por extracción) | baby |
|---|---|---|---|---|---|
| A1-4 Venusaur ex ◊◊◊◊ | A1/mewtwopack | 1.66073 | [0,0,0,0.3332,1.3328] | 0 | 0 |
| A1-286 Mewtwo ex Crown | A1/mewtwopack | 0.07700 | [0,0,0,0.01333,0.05333] | 1/22 = 0.04545 | 0 |
| A4-32 Magby ◊◊◊ baby | A4/ho-ohpack | 2.41848 | [0,0,0,0,0] | 0 | 0.29033 |
| A4a-105 Mantyke Crown baby | A4a/suicunepack | 0.20677 | [0,0,0,0.04,0.16] | 1/34 = 0.02941 | 0 |
| A2b-100 ✵ | A2b/shiningrevelrypack | 0.36283 | [0,0,0,0.07143,0.2857] | 1/39 = 0.02564 | 0 |
| A4b-1 Bulbasaur ◊ (id = A1-1) | A4b/deluxepack | 1.09688 | [0.78125,0.13852,0.17985,0] | – | – |
| A4b-360 ☆☆ | A4b/deluxepack | 0.15625 | [0,0,0.15625,0] | – | – |
| B4b-13 ◊◊◊ baby (bug §1.8) | B4b/deluxepackmega | 0.78190 | [0,0,0.7819,0] | – | – |
| B4b-428 Crown | B4b/deluxepackmega | 0.09900 | [0,0,0.099,0] | – | – |
| B1-109 ◊◊◊ baby (bug §1.8) | B1/megablazikenpack | 1.76286 | [0,0,0,0.35375,1.415] | 0 | 0 |

(A4-166 Magby ☆ está en ho-ohpack, no en lugiapack: al evaluarla en lugiapack da 0, correcto.)

### Lógica del port (`port.mjs`) para convertir en tests
```
positionTable(structure, pos): deluxe si cardsPerPack=4; pos<=3 → ◊100; pos4/5 → variante shiny si containsShinies
pullRateDetailed(missing, cardsInPack, structure, deckbuildingMode):
  wanted = cardsInPack ∩ (deckbuilding ? alternate_versions∋missingId : internal_id∈missingIds)
  por carta (salteando 'P'):
    baby && rarity≠Crown && containsBabies → baby += BABY[rarity]/100/#babies_de_esa_rareza
    si no → k = #(rareza, Crown || !baby); perPos[i] = tabla[i][rarity]/100/k; rare += elegible/#elegibles (solo 5 cartas)
  pNone = ∏(1 − ΣperPos[i]); eStd = ΣΣperPos
  4 cartas: P = 1−pNone; E = eStd
  5 sin babies: P = 0.9995(1−pNone) + 0.0005(1−(1−rare)^5); E = 0.9995·eStd + 0.0005·5·rare
  5 con babies: P = 0.9162(1−pNone) + 0.0005(…) + 0.0833(1−pNone(1−baby)); E = 0.9162·eStd + 0.0005·5·rare + 0.0833(eStd+baby)
getFilteredCards: deckbuilding → internal_id===alternate_versions[0]; rarity; amount_owned (suma alternate_versions o exacto); min/maxNumber
overviewWantedCards = getFilteredCards({rarity, deckbuildingMode, maxNumber: number−1})
```

---

## 4. Valor esperado y sobres necesarios

- **E[cartas buscadas por sobre]** = Σ_cartas Σ_posiciones p (linealidad), ponderado por la mezcla de sobres (fórmulas arriba). En la tabla, `E_c` de A3/solgaleopack = 3.07 cartas/sobre con 89 buscadas de 140; A4b (a) = 2.27.
- **Sobres para alcanzar confianza q de ≥1 acierto**: `n = ⌈ln(1−q)/ln(1−p)⌉` (geométrica). Ejemplos (filtro c): B4b/deluxepackmega p=59.04 % → 50 %: 0.8 → 1 sobre; 90 %: 2.6 → 3 sobres; E[sobres hasta el primer acierto] = 1/p = 1.7. A1/mewtwopack p=67.99 % → 90 %: 2 sobres.
- **E[sobres hasta conseguir TODAS las cartas de un conjunto S]** (coupon collector con probabilidades desiguales): exacto bajo independencia entre sobres, `E[T] = Σ_{∅≠J⊆S} (−1)^{|J|+1} / P(≥1 de J en un sobre)`, donde `P(≥1 de J)` se calcula con el mismo modelo. Es 2^|S|: viable hasta |S| ≈ 12–15; para más, **Monte Carlo** muestreando sobres del modelo (barato, da intervalo) o la cota inferior `max_i c_i / P_i` (c_i copias que faltan, P_i probabilidad por sobre de la carta i). Para copias múltiples (c_i = 2) la inclusión–exclusión deja de ser simple: usar simulación.
- Supuestos a declarar en la UI: tasas constantes, sin pity, independencia entre posiciones y sobres, duplicados posibles dentro de un sobre, elección de sobre fija (la política óptima real es secuencial: re-evaluar tras cada importación).

---

## 5. Puntos de sobre e intercambio

- `craftingCost` (`CardsDB.ts:398-407`): ◊ 35, ◊◊ 70, ◊◊◊ 150, ◊◊◊◊ 500, ☆ 400, ☆☆ 1250, ☆☆☆ 1500, Crown 2500. **Faltan ✵ y ✵✵** (fuentes comunitarias: 1000 y 1350; sin verificar en juego) y P (no comprable). `CardDetail.tsx:239` oculta la fila cuando falta. Locale es-ES: "Puntos abresobres" (`locales/es-ES/pages/card-detail.json:6`).
- Intercambio: `tradableRarities = ['◊','◊◊','◊◊◊','◊◊◊◊','☆','☆☆','✵','✵✵']` (`types/index.ts:34`); `tradableExpansions` = todas con `tradeable: true` (`CardsDB.ts:394`): incluye A4b/B4b; excluye P-A/P-B. Uso: `utils.ts:100,130` y `CardDetail.tsx:188`. Según las fuentes que pude leer (2025), el juego solo intercambia ◊, ◊◊, ◊◊◊, ◊◊◊◊ y ☆ (misma rareza entre ambas cartas; ☆☆/promo "en estudio"); el costo pasó de fichas a shinedust (◊/◊◊ gratis; ◊◊◊, ◊◊◊◊, ☆ con costo — las cifras que vi, 1200/5000/4000, no las pude verificar). Discrepancia tracker vs juego: pendiente de confirmar a oct-2026.
- No hay nada de "wonder pick" ni de saldo de puntos en el repo (grep: solo `craftingCost` y locales).
- Reglas del juego relevantes: los puntos de sobre son por expansión; los del Deluxe solo sirven dentro del Deluxe y quedan inservibles cuando el set se retira (ventana de ~30 días).
- Para "costo en puntos y si es intercambiable" por carta faltante necesitamos: tabla rareza→costo completa (con ✵/✵✵ y P = no comprable), saldo de puntos por expansión (carga manual del usuario; opcional), `tradeable = expansion.tradeable && rarity ∈ tradableRarities` con la lista como configuración, y la disponibilidad del sobre (si el Deluxe ya no está, el costo no aplica).

---

## 6. Comparación con tasas oficiales/comunitarias

| Ítem | Tracker | Fuente externa | Diferencia |
|---|---|---|---|
| Común pos. 4 / 5 | tabla §1.1 | pokemon-zone / dotesports: idénticas (90/5/1.666/2.572/0.5/0.222/0.04; 60/20/6.664/10.288/2/0.888/0.16) | ninguna |
| Shiny pos. 4 | 89 / 4.9525 / … / 0.71425 / 0.33325 | game8: 89 / 4.952 / 1.666 / 2.572 / 0.5 / 0.222 / 0.714 / 0.333 / 0.04 (suma 99.999) | el tracker agrega decimales para cerrar en 100.000 |
| Shiny pos. 5 | 56 / 19.81 / 6.664 / 10.288 / 2 / 0.888 / 2.857 / 1.333 / 0.16 | game8: idéntica | ninguna |
| Rare pack | 0.0005, uniforme por carta elegible | 0.050 %; A1: ☆ 40 / ☆☆ 50 / ☆☆☆ 5 / Crown 5; shiny: 28.571 / 33.333 / 2.38 / ✵ 23.809 / ✵✵ 9.523 / Crown 2.38 | ponderación distinta; ≤ 0.05 pp |
| Sobre de 6 | 0.0833; 6.ª ◊◊◊ 87.1 / ☆ 12.9 | "8.3 %"; por carta 29.033 % (= 87.1/3) y 12.900 % | ninguna |
| Babies solo en A4/A4a | containsBabies true solo ahí | fuentes: solo Wisdom of Sea and Sky (+ A4a en catálogo) | coherente |
| Crown A1 en los 3 sobres | 'everypack' → 0.04/3 por carta | dexerto: 0.013 % / 0.053 % por carta | coherente |
| Deluxe ex pos. 1–4 | §1.1 | destructoid/bulbapedia: 100; 82.270/17.730; 40.659/23.021/17.985/12.858/2.5/1.111/1.667/0.198; 100 | idénticas |
| Deluxe Mega | misma tabla | nintendolife/zatu: misma pos. 3 | idénticas |
| Deluxe rare pack | ignorado | 0.050 %, 4 cartas uniformes 1/26 (A4b) | < 0.05 pp |

---

## 7. Notas de diseño para M4 (dos objetivos → un conjunto ponderado)

1. **Peso por copia faltante.** Para cada carta funcional f: `deficit_deck(f) = max_m prio_m · max(0, copias_requeridas_m(f) − copias_jugables(f))` (tomar el máximo entre mazos, no la suma, porque las copias no se reparten; `prio_m ∈ {1,2,3}` o 0 si no es objetivo). `deficit_col(e) = 1` por edición e no poseída cuyo rareza pasa el filtro (objetivo colección es por edición, no funcional). Peso final: `w(e) = α·deficit_deck(func(e))·[e es edición jugable, i.e. cualquier edición] + (1−α)·deficit_col(e)`, con α el control deslizante del brief. Conjunto buscado = {e : w(e) > 0}.
2. **Dos métricas por sobre, siempre juntas:** `P(≥1 buscada)` (modelo tracker, con los fixes §1.8/§1.9) y `EV = Σ_e w(e)·P_e(sobre)` (valor esperado ponderado; usa las mismas `P_e` por carta). Más: `E[cartas buscadas]`, sobres para 50/90 %, y para el objetivo "mazo X completo" la E[sobres] por inclusión–exclusión/Monte Carlo de §4.
3. **Pitfalls:** P(≥1) premia sobres con muchas comunes baratas (5 comunes al 2 % ≈ 9.6 % vs un ex al 0.1 %); EV con pesos iguales hace lo mismo. Si lo que falta es un ex puntual, el peso alto (prioridad × copia que destraba un mazo) debe dominar; además hay que **descontar la alternativa de comprar con puntos**: si `costo(rareza) ≤ saldo` o `costo/E[puntos por sobre]` (5 puntos por sobre común) es menor que `1/P_e`, marcar "comprá, no abras". Ignorar P y `everypack`-solo-nombre (§1.3). Deluxe: el 4.º slot garantiza ◊◊◊◊, así que un mazo con ex faltantes casi siempre prefiere A4b/B4b mientras esté disponible (interruptor de disponibilidad obligatorio). Re-calcular tras cada importación: la política es secuencial.
4. **Modo "compatible con tracker"** para el test de aceptación: mismas tablas, bug §1.8 y prefiltro §1.9 reproducidos, filtro (a)/(b)/(c) → debe dar la tabla de §3 con `toFixed(1)`.

## Recomendaciones
- **Portar `stats.ts` tal cual** (tablas, mezcla 0.9995/0.0005 y 0.9162/0.0005/0.0833, rama baby, salto de P, `everypack`) como módulo de dominio puro en TypeScript, con un flag `trackerCompat`. Tests: (1) sumas por posición = 100.000 salvo Deluxe pos. 3 = 99.999 (documentar o normalizar); (2) la tabla de §3 con el CSV de contexto y los tres filtros, tolerancia 1e-4 en % (o `toFixed(1)` para el test "coincide con el tracker"); (3) los fixtures por carta de §3.
- **Corregir, fuera del modo compat:** (a) denominador `k` excluye babies solo si `containsBabies` (§1.8); (b) en modo mazos no prefiltrar las buscadas por expansión (§1.9); (c) incluir A4b/B4b y, en general, toda expansión con `packStructure`, con interruptor "disponible" por sobre; (d) opcional: rare pack ponderado por rareza y rare pack del Deluxe (efecto ≤ 0.05 pp; dejar como mejora menor).
- **Mostrar por sobre**: P(≥1), E[cartas buscadas], EV ponderado, sobres para 50 %/90 % (`ln(1−q)/ln(1−p)`), y E[sobres para completar] por inclusión–exclusión (|S| ≤ 12) o Monte Carlo con IC. Declarar supuestos en la UI.
- **Puntos e intercambio**: completar la tabla de costos con ✵ 1000 / ✵✵ 1350 (marcar "sin verificar" hasta confirmar en juego) y P = no comprable; hacer configurable la lista de rarezas intercambiables (default conservador ◊..◊◊◊◊ + ☆, con nota de que el tracker usa ☆☆/✵/✵✵); `tradeable = expansion.tradeable && rarity ∈ lista`; saldo de puntos por expansión como dato manual opcional.
- **Catálogo (impacta M1/M4)**: indexar cartas por sobre con `pack ∈ {name, 'everypack'}`; guardar `packStructure` por expansión versionado con el commit del tracker; anotar los ids huérfanos B2a-89/B2a-92.
- Ponderación de objetivos: peso por copia faltante (máximo entre mazos, no suma), α entre mazos/colección, y regla "comprar con puntos vs abrir" (§7).

## Riesgos
- **Tablas hardcodeadas por tipo de sobre** (5 cartas, 5+shiny, 6 baby, 4 Deluxe): cada estructura nueva del juego exige código. Mitigación: tablas como datos versionados con test de suma = 100 y fecha/fuente.
- **Drift respecto del tracker**: el sitio público puede tener un `cards.json` o un `stats.ts` más nuevo que 3ab58f1; el test "coincide con el tracker" puede fallar por datos, no por lógica. Mitigación: fijar commit y CSV en el fixture; comparar con `toFixed(1)`.
- **Bugs del tracker reproducidos** (§1.8 babies, §1.9 prefiltro): si copiamos literal, heredamos errores de hasta ~2 pp en modo mazos. Mitigación: flag `trackerCompat` solo para el test; default corregido y documentado en DECISIONES.md.
- **Heurística `baby`** del scraper (hp 30, sin debilidad) puede marcar cartas que el juego no trata como baby en sets B; con el fix §1.8 el impacto desaparece salvo que un set B futuro tenga sobres de 6.
- **Sobres Deluxe con ventana temporal**: una recomendación sobre un sobre que ya no existe es inútil; el interruptor de disponibilidad debe ser visible y fácil de tocar.
- **Costos ✵/✵✵ y reglas de intercambio sin verificar en juego**: mostrar como "sin confirmar" hasta que el usuario lo valide.
- **Independencia/sin pity**: el modelo puede diferir de la implementación real del juego; comunicar como estimación.

## Preguntas abiertas
1. ¿Querés que la app muestre por defecto el número "compatible con tracker" (con sus bugs) o el corregido (§1.8, §1.9), dejando el otro solo en tests? Mi propuesta: corregido por defecto, modo compat solo en tests.
2. En A4/A4a, ¿viste en el juego que las babies ◊◊◊/☆ aparezcan también en las posiciones 4/5 de un sobre normal, o solo como 6.ª carta? (El tracker asume solo 6.ª.)
3. ¿Podés confirmar en el juego, hoy, qué rarezas se pueden intercambiar (¿☆☆, ✵, ✵✵?) y el costo en shinedust por rareza? Y el costo en puntos de ✵ y ✵✵ (¿1000 / 1350?).
4. ¿Querés cargar a mano el saldo de puntos de sobre por expansión para que la app sugiera "comprar vs abrir"?
5. Para el peso entre mazos: ¿prioridad por mazo en 3 niveles alcanza, y preferís "máximo entre mazos" (como propongo) o suma?
6. ¿El Deluxe ex (A4b) sigue disponible en el juego a esta fecha? Define el default del interruptor "disponible".

## Fuentes
**Código (refs/tracker @ 3ab58f1, rutas bajo `C:\Users\<usuario>\Personal\tcg pocket\refs\tracker\`)**
- `frontend/src/lib/stats.ts:8-21` (createRarityProbability), `:24-66` (tablas 5 cartas), `:69-83` (tablas Deluxe), `:85-97` (rare pack elegibles, baby), `:99-118` (getPositionProbability), `:120-131` (pullRate, prefiltro `:126`), `:133-140` (pullRateForSpecificCard, `:137` everypack→packs[0]), `:142-172` (misiones), `:174-251` (pullRateForCardSubset; `:188` skip P; `:197-201` baby; `:204` denominador; `:214` rare uniforme; `:228` producto; `:240-247` mezcla)
- `frontend/src/lib/filters.ts:75-185` (getFilteredCards; `:79`, `:99-102`, `:155-160`, `:168-175`)
- `frontend/src/pages/overview/Overview.tsx:48-51, 64-66, 68-86, 159-228` (`:70`, `:73`, `:76`, `:79-82`, `:161`, `:185-189`, `:213-221`)
- `frontend/src/components/filters/RarityFilter.tsx:13-21`
- `frontend/src/lib/CardsDB.ts:31-382` (expansiones; `:196`, `:355` openable false; `:394` tradableExpansions; `:398-407` craftingCost)
- `frontend/src/types/index.ts:33-34` (rarities, tradableRarities), `:124-129` (PackStructure)
- `frontend/src/lib/utils.ts:93-123` (getWantedCards/getExtraCards), `:130`
- `frontend/src/pages/collection/CardDetail.tsx:188, 236-239`
- `frontend/src/pages/import/components/ImportReader.tsx:26-27`
- `scripts/scraper.ts:362-422` (rarity, baby `:373`, linked cards `:382-402`, foil `:404-414`)
- `frontend/public/locales/es-ES/pages/card-detail.json:6`, `locales/es-ES/pages/overview.json`
- `frontend/assets/cards.json` (4317 cartas; conteos por sobre/rareza calculados)
- CSV: `C:\Users\<usuario>\Downloads\tcgcollectiontracterexport (2).csv` (solo lectura)

**Scripts descartables (scratchpad)**: `cardsdb-shim.mjs`, `stats-verbatim.ts`, `port.mjs`, `runner.mjs`, `runner-output.txt`, `crossexp.mjs`, `linked.mjs` en `C:\Users\<usuario>\AppData\Local\Temp\claude\C--Users-<usuario>-Personal-tcg-pocket\744b015a-5491-4593-b20b-d31f39f97693\scratchpad\`

**Web**
- https://www.pokemon-zone.com/articles/booster-pack-guide/ (tasas sobre común, rare pack 0.05 %)
- https://dotesports.com/pokemon/news/all-genetic-apex-rare-card-offering-rates-in-pokemon-tcg-pocket
- https://ptcgpocket.gg/rare-packs/ (composición rare pack A1)
- https://game8.co/games/Pokemon-TCG-Pocket/archives/474500 (tasas sets con shinies y rare pack shiny)
- https://www.dexerto.com/pokemon/rarest-cards-in-pokemon-tcg-pocket-pull-rates-2971330/ (Crown por carta A1/A1a/A2; ✵✵ por carta)
- https://www.destructoid.com/deluxe-pack-ex-odds-why-its-impossible-to-get-a-pokemon-tcg-pocket-master-set/ (Deluxe ex, regular y rare pack)
- https://www.nintendolife.com/news/2026/09/pokemon-tcg-pockets-next-expansion-has-a-guaranteed-rare-in-every-pack y https://zatu.com/blogs/news/pokemon-tcg-pocket-gets-ready-for-deluxe-pack-mega (Deluxe Mega)
- https://insider-gaming.com/how-to-get-a-six-card-pack-in-pokemon-tcg-pocket-sixth-card-explained/ y https://www.beckett.com/news/pokemon-tcg-pocket-wisdom-of-sea-and-sky-checklist-a4-card-list/ (sobre de 6, 29.033 %/12.900 %)
- https://pokemon-zone.com/articles/pack-points y https://20cards.com/guides/pack-points (puntos por rareza); https://sportskeeda.com/pokemon/pokemon-tcg-pocket-card-rarity-guide (✵ 1000 / ✵✵ 1350, sin verificar)
- https://esports.gg/news/pokemon-tcg-pocket/pokemon-tcg-pocket-to-remove-trade-tokens-and-require-shinedust-for-trades y https://www.sportskeeda.com/pokemon/how-trade-pokemon-tcg-pocket-rules-currency-requirements (rarezas intercambiables, shinedust)
- https://worldofgeek.fr/pokemon-tcg-pocket-pack-deluxe-ex-polemique/ (puntos del Deluxe solo dentro del Deluxe)
- https://pocket.limitlesstcg.com/cards/A1/286 (tabla de versiones de Mewtwo ex)

> Informe de investigación automático de la Fase 0 (6/10/2026), generado por agentes de Claude Code sobre `refs/tracker` @ 3ab58f1, `refs/deckgym-core` @ fb792ebf, la API de Limitless y documentación pública. Las rutas `C:\Users\<usuario>\AppData\Local\Temp\...` son scripts descartables de la sesión. Los números de colección se calcularon con la exportación del 1/10/2026 que estaba en Descargas; el plan usa la del 6/10/2026 en `docs/context/`. Las secciones "Preguntas abiertas" quedaron consolidadas en `docs/PLAN.md` §8.

# catalog

## Resumen
Catálogo del tracker (commit 3ab58f1): 4.317 filas en cards.json, 3.866 internal_id distintos (450 ids compartidos por 901 filas: 449 pares + 1 trío Ámbar Viejo) y 2.319 grupos funcionales (alternate_versions). Un internal_id se comparte solo cuando el set tiene containsLinkedCards (A1a, A4b, B4b), la rareza es ◊..◊◊◊◊ y hay una impresión anterior de igual rareza en OTRO set; la "segunda tanda" foil de los Deluxe (A4b nº par, B4b 237-402) recibe id propio. 555 nombres mapean a más de un grupo funcional, todos con texto distinto (Riolu A2-91 vs B3-79, Eevee 12 grupos). Nombres es-ES: reimplementé getCardNameByLang y coincide 4.317/4.317 con la columna CardName del CSV, sin fallbacks al inglés; no hay texto de ataques en español en el repo (image-locales.json es un bitmask de imágenes localizadas). CSV real: mismo orden que cards.json, BOM, LF, sin comillas; las 450 filas duplicadas siempre repiten NumberOwned/Collected; suma ingenua 5.495 vs deduplicada 4.520; Mega-Mawile ex = 2, Globito = 2 (este CSV es anterior al del 5/10: Espeon ex = 1, Mega-Sharpedo = 0), Bulbasaur A1-1 = 3, Latias 3, Latios 1, Hoopa ex 1, Riolu A2-91 = 1, Riolu B3-79 = 7. Importador del tracker: exige Id/InternalId/NumberOwned/Collected, upsertea todas las filas (0 incluido, no borra), Collected FALSE solo baja la bandera. containsLinkedCards es una directiva del scraper (commit e0b0d090, fix #855), no toca stats.ts: para probabilidades es dato muerto; lo que manda es cardsPerPack === 4. Propongo sincronizar desde raw.githubusercontent.com a commit fijado, parseando `expansions` de CardsDB.ts con la API de TypeScript + new Function (probado con regex: 24 expansiones), con card_id como identidad y remapeo de internal_id entre commits (ya cambiaron dos veces en 2026).

## Hallazgos
# Catálogo del tracker, grupos funcionales, nombres en español, CSV y proceso de actualización

Todo lo que sigue se calculó con scripts node sobre `refs/tracker` @ `3ab58f1cec6a03e3e85455cf7aade3bb8561f92e` (último commit de `main`, 2026-10-01, "feat: add Deluxe Pack: Mega (B4b) and Promo-B 95-103 (#1037)") y sobre `C:\Users\<usuario>\Downloads\tcgcollectiontracterexport (2).csv`. Script de análisis: `C:\Users\<usuario>\AppData\Local\Temp\claude\C--Users-<usuario>-Personal-tcg-pocket\744b015a-5491-4593-b20b-d31f39f97693\scratchpad\analyze.mjs` (salida `out.json` en la misma carpeta). No había trabajo previo en el scratchpad: estaba vacío, así que arranqué de cero.

## 1. `frontend/assets/cards.json`: esquema, dominios, internal_id, alternate_versions

### 1.1 Esquema (4.317 filas, JSON con sangría 2, CRLF en el clon por autocrlf, ordenado por `expansion` como string ascendente y luego número: A1,A1a,A2,A2a,A2b,A3,A3a,A3b,A4,A4a,A4b,B1,B1a,B2,B2a,B2b,B3,B3a,B3b,B4,B4a,B4b,P-A,P-B)

| Campo | Presente en | Dominio / notas |
|---|---|---|
| `expansion` | 4317 | 24 ids (`types/index.ts:5-30`). Conteo: A1 286, A1a 86, A2 207, A2a 96, A2b 111, A3 239, A3a 103, A3b 107, A4 241, A4a 105, A4b 379, B1 331, B1a 103, B2 234, B2a 131, B2b 117, B3 234, B3a 109, B3b 106, B4 233, B4a 110, B4b 429, P-A 117, P-B 103 |
| `card_id` | 4317 | `<expansion>-<nr>`; siempre empieza con `expansion + '-'`; nr máximo 429 |
| `image` | 4317 | siempre `/images/en-US/<card_id>.webp` (verificado 4317/4317) |
| `name` | 4317 | inglés, tal cual Limitless. 1.383 nombres distintos (1.220 Pokémon, 163 Entrenador) |
| `hp` | 3930 | 3.922 Pokémon + 8 Entrenadores fósil con hp 40 (A1-216, A1-217, A1-218, A1a-63, A4b-312, A4b-313, B2-144, B2-146; los otros fósiles A2-144/145, B1-214/216, B4-146/147 no lo tienen). Valores 30..250 en pasos de 10 |
| `energy` | 4317 | water 575, grass 522, colorless 520, psychic 460, fighting 423, trainer 395, darkness 363, lightning 356, fire 351, metal 239, dragon 113 |
| `card_type` | 4317 | `pokémon` 3922 (con tilde), `trainer` 395 |
| `evolution_type` | 4317 | pokémon: basic 2157, stage1 1285, stage2 480; trainer: supporter 236, item 73, tool 53, stadium 33 |
| `attacks[]` | 4317 | `{cost: string[], name, damage: string, effect}`. 0 ataques: 395 (todos los trainers), 1: 3789, 2: 133. `cost` tokens: colorless 3130, water 921, fighting 611, grass 590, fire 552, lightning 538, psychic 519, darkness 491, metal 392, `'No Cost'` 40. `damage` es string: números, `30+`, `50x`, y **ruido de scraping**: en 40 formas distintas aparece la última palabra del nombre del ataque como daño (`Friend`, `Whip`, `Dance`, `Arrow`...), cuando el ataque sin daño tiene nombre de varias palabras (`scraper.ts:342-344`). `effect` = `'No effect'` si vacío |
| `ability` | 924 | `{name, effect}`. **Los 395 trainers lo tienen con `name: ''`** y el efecto de la carta en `effect`; 529 Pokémon con habilidad real. **Los 395 efectos de trainer traen basura al final**: `"\n\n ... Illustrated by \n kirisAki"` (artista pegado; `scraper.ts:209-218` toma el siguiente `div.card-text-section` completo) |
| `weakness` | 4317 | fighting 891, fire 734, lightning 703, grass 406, `N/A` 395 (trainers), darkness 338, water 327, metal 205, psychic 165, `none` 153 |
| `retreat` | 3922 | solo Pokémon: 0: 98, 1: 2210, 2: 1058, 3: 448, 4: 108 |
| `rarity` | 4317 | ◊ 1257, ◊◊ 976, ◊◊◊ 479, ◊◊◊◊ 301, ☆ 281, ☆☆ 389, ☆☆☆ 34, ✵ 244, ✵✵ 97, `Crown Rare` 39, `P` 220. `P` solo en P-A (117) y P-B (103), y esos sets solo tienen `P` |
| `ex` | 4317 | true 762; equivale exactamente a `name.includes(' ex')` (0 discrepancias); solo Pokémon |
| `baby` | 4317 | true 36 (heurística `weakness==='none' && hp===30 && energy!=='dragon'`, `scraper.ts:373`): Magby, Pichu, Elekid, Smoochum, Cleffa, Tyrogue, Mantyke, Igglybuff, Azurill, Chingling, Budew, Bonsly, Mime Jr., Wynaut, Happiny |
| `pack` | 4317 | `everypack` 3038; lugiapack 105, ho-ohpack 105, lunalapack 99, solgaleopack 99, arceuspack 96, megablazikenpack 96, megagyaradospack 96, megaaltariapack 96, mewpack 86, dialgapack 81, palkiapack 81, pikachupack 80, charizardpack 80, mewtwopack 79. Solo A1/A2/A3/A4/B1 (multi-sobre), A1a (mewpack) y A2a (arceuspack) tienen sobre con nombre; **desde A2b todo es `everypack`** aunque CardsDB declare `shiningrevelrypack`, `crimsonblazepack`, etc. (la etiqueta de Limitless no coincide con la lista `packs` de `scraper.ts:18-47` y cae al default `'everypack'`, `scraper.ts:259`). 15 expansiones tienen cartas `everypack` sin ese sobre en CardsDB; `stats.ts:124` lo tolera con `c.pack === pack.name || c.pack === 'everypack'` |
| `alternate_versions` | 4317 | `number[]` de internal_ids; siempre incluye el propio; ver 1.3 |
| `artist` | 4317 | string, `'Unknown'` si falta |
| `internal_id` | 4317 | ver 1.2 |

`Card` en `frontend/src/types/index.ts:147-179` declara además `amount_owned`, `collected`, `updated_at` opcionales (calculados en runtime, no en el JSON).

### 1.2 `internal_id`: codificación exacta

`scripts/encoder.ts:23`: `(expansionId << 16) | (cardNr << 6) | rarityId`, 24 bits: 8 bits expansión (1..199), 10 bits número (1..999), 6 bits rareza. `expansionId` = `Expansion.internalId` de `CardsDB.ts` (A1 1, A1a 2, A2 3, A2a 4, A2b 5, A3 6, A3a 7, A3b 8, A4 9, A4a 10, A4b 11, B1 12, B1a 13, B2 14, B2a 15, B2b 16, B3 17, B3a 18, B3b 19, B4 20, B4a 21, B4b 22, P-A 192, P-B 193; comentario "should NEVER EVER change", `CardsDB.ts:36`). `rarityId` (`encoder.ts:42-59`): ◊ 0, ◊◊ 1, ◊◊◊ 2, ◊◊◊◊ 3, ☆ 4, ☆☆ 5, ☆☆☆ 6, ✵ 8, ✵✵ 9, Crown Rare 12, P 16 (7, 10, 11, 13-15, 17-63 libres). Postgres y el frontend usan `internal_id & 63` como rareza (`filters.ts:62`, migración `2026-08-b4a-rarity-remap.sql:3-11`). Máximo observado: 12.655.056 (P-B).

Verificación: 3.864 filas tienen `internal_id === encode(propia expansión, propio nr, propia rareza)`; **453 filas apuntan a otro lado**: B4b 236, A4b 214, A1a 1 (A1a-63 Ámbar Viejo → A1-218), B2a 2. Las de A4b/B4b/A1a apuntan a una carta real con mismo nombre y rareza (214/214 y 236/236). **Las 2 de B2a son ids huérfanos**: B2a-89 Iono ◊◊ = 333377 = encode(A2b, 89, ◊◊) y B2a-92 Penny ◊◊ = 530177 = encode(A3b, 92, ◊◊); A2b-89 es Pokémon Center Lady ☆☆ y A3b-92 es Eevee ex ☆☆☆, o sea que decodificar esos ids no da una carta existente. Es un resto del fix #855 (commit e0b0d090, 2026-02-27): el scraper fija `baseExpansion` al set de la impresión anterior pero, como B2a no tiene `containsLinkedCards`, conserva su propio número (`scraper.ts:399-400`). **Consecuencia para nuestra app: nunca decodificar internal_id para obtener card_id; usar lookup.**

### 1.3 `alternate_versions`: cómo se construye y qué es `deckbuilding_id`

`scraper.ts:384-416`: por cada carta recorre la tabla `table.card-prints-versions` de Limitless (todas las impresiones de la misma carta, en orden) y acumula sus `card_id`; luego (`scraper.ts:502-507`) los convierte a internal_id, deduplica con `Set` y ordena ascendente. Después (`scraper.ts:509-517`) `deckbuildingOverrides = [12583376, 12583248, 133058]` mueve ese id al frente del array si está. `scripts/sql/generate-cards-table.ts:46` define `deckbuilding_id = alternate_versions[0]`; `filters.ts:79` muestra en modo deckbuilding solo las cartas con `internal_id === alternate_versions[0]`; `pages/decks/utils.ts:34` agrupa por `alternate_versions[0]`.

Los 3 overrides, 6 filas afectadas (en esos grupos `alt[0]` no es el mínimo):
- 133058 = A1a-31 Mew ◊◊◊ pisa a A1-283 Mew ☆☆☆ (83654)
- 12583248 = P-A-5 Poké Ball (P) pisa a A2b-111 Poké Ball Crown Rare (334796)
- 12583376 = P-A-7 Professor's Research (P) pisa a A4b-373 ☆☆ (744773)
El resto de cada array sí está ordenado ascendente (verificado). **Regla para nosotros: `deckbuilding_id = alternate_versions[0]` tal cual, no `min()`.**

Números:
- 3.866 internal_ids distintos; **450 grupos de filas con el mismo internal_id** (449 de tamaño 2, 1 de tamaño 3: Old Amber A1-218 = A1a-63 = A4b-312), 901 filas involucradas, 451 filas "duplicadas". En cada grupo coinciden nombre, rareza, texto y `alternate_versions` (4/4 checks true).
- Pares por sets: A1+A4b 42, B1+B4b 40, B4+B4b 39, B3+B4b 38, B2+B4b 33, A3+A4b 30, A2+A4b 29, A2b+A4b 24, A4+A4b 24, B2a+B4b 21, B3b+B4b 20, A3b+A4b 19, B2b+B4b 19, A3a+A4b 16, B1a+B4b 16, A2a+A4b 15, A1a+A4b 14, B3a+B4b 10, A1+A1a+A4b 1.
- **2.319 grupos funcionales** (por `alternate_versions[0]`; coincide exactamente con componentes conexas por union-find sobre los arrays, y ninguna carta tiene arrays inconsistentes con su grupo; ningún id de `alternate_versions` falta del catálogo). Tamaño por ids distintos: 1: 1361, 2: 571, 3: 236, 4: 110, 5: 31, 6: 10. Por filas: 1: 1361, 2: 454, 3: 163, 4: 195, 5: 107, 6: 29, 7: 10.
- Dentro de un grupo el nombre es siempre el mismo (0 excepciones). El texto "crudo" difiere en 18 grupos (todos Entrenadores: Erika, Brock, Sabrina, Iono, Poké Ball, Guzma, Lillie, Penny, Silver, Hiker, Professor's Research, Copycat, Nemona, Arven, Iris, Elesa, Team Rocket's Master Plan, Pokédex), pero **solo por el artista pegado en `ability.effect`**: normalizando con `replace(/\s*Illustrated by[\s\S]*$/,'')` quedan **0 grupos con texto distinto**. Y a la inversa: 0 casos de mismo nombre + texto normalizado idéntico en grupos separados. O sea, `alternate_versions` ES exactamente "misma carta funcional" (bajo la definición de Limitless) y no hace falta corregirlo.

### 1.4 Cuándo una reimpresión COMPARTE internal_id y cuándo recibe uno NUEVO

Regla del scraper (`scraper.ts:398-414`), confirmada contra los datos:
1. Solo si la rareza contiene ◊ (◊, ◊◊, ◊◊◊, ◊◊◊◊); ☆ y superiores nunca se enlazan.
2. Si en la tabla de impresiones hay una anterior con la MISMA rareza, se toma como base: `baseExpansion` = set de esa impresión; `baseCardNr` = número de esa impresión **solo si `expansion.packStructure.containsLinkedCards`** (A1a, A4b, B4b); si no, conserva su número (caso Iono/Penny).
3. Pero si la impresión anterior de igual rareza está en el MISMO set, se desenlaza y se trata como carta única ("foil").

Resultado por set:
- **A4b (379)**: 214 comparten id (◊ 64, ◊◊ 50, ◊◊◊ 25, ◊◊◊◊ 75; bases en A1, A1a, A2, A2a, A2b, A3, A3a, A3b, A4) y 165 tienen id propio: 139 ◊-class "parallel foil" (◊ 64, ◊◊ 50, ◊◊◊ 25) **cada una inmediatamente precedida por su gemela enlazada** (139/139: A4b-1 Bulbasaur = A1-1, A4b-2 Bulbasaur foil propia, A4b-3 Ivysaur = A1-2, A4b-4 foil...), más 26 de arte nuevo/alta rareza (☆ 6, ☆☆ 16, ☆☆☆ 1, ✵✵ 2, Crown 1). Los ex (◊◊◊◊) no tienen gemela foil.
- **B4b (429)**: nº 1-236 comparten id (◊ 71, ◊◊ 65, ◊◊◊ 30, ◊◊◊◊ 70; bases en B1, B1a, B2, B2a, B2b, B3, B3a, B3b, B4) y nº 237-402 son 166 foils con id propio, todas con gemela enlazada en 1-236; más 27 de alta rareza (☆ 6, ☆☆ 16, ☆☆☆ 1, ✵✵ 2, Crown 2).
- Ejemplo pedido: Globito/Small Balloon: B3b-64 ◊ = 1249281; B4b-206 ◊ comparte 1249281; **B4b-372 ◊ es la foil de la segunda tanda → id propio 1465601**; grupo [1249281, 1251980 (B3b-106 ☆), 1465601]. Bulbasaur: A4b-1 comparte 65600 con A1-1; grupo [65600, 80068 (A1-227 ☆), 406664 (A3-210 ✵), 721024 (A4b-2 foil), 12584400 (P-A-23)].
- Fuera de los Deluxe solo A1a-63 (Ámbar Viejo, issue #306) comparte id.

### 1.5 Mismo nombre, distinto texto

**555 de los 1.383 nombres mapean a más de un grupo funcional** (2 grupos: 309, 3: 154, 4: 68, 5: 17, 6: 3, 7: 1, 8: 1, 9: 1, 12: 1), y en los 555 el texto difiere entre grupos (0 casos de split espurio). Diez ejemplos (card_id del representante, `+n` = otras ediciones del grupo):
1. Riolu: A2-91 (Jab 20) / A2b-42(+4) / B3-79(+3) (Fighting Fist 10+, +30 vs ex)
2. Dratini: A1-183 / A3b-51(+2) / B2b-51(+1) / B4-116(+3)
3. Magnezone: A2-53(+2) / A2a-55 / B1a-26
4. Furfrou: B1-206(+2) / B1a-65 / B2-141 / B2b-64 / B3-144 / B3b-61 / B4-142 / B4a-64 (8 grupos)
5. Oricorio: A3-34 / A3-66(+4) / A3-76 / A3-77(+2) / B2-22(+1) / B3-68(+1) / B4-78(+1) (7)
6. Eevee: 12 grupos (A1-206(+4), A1a-61, A2-126, A2a-62, A3b-55(+3), A4-134(+1), B1-184(+5), B3-129, B3a-56, B3b-53, B4-131, P-A-30)
7. Silvally: A3a-61(+4) / B4-144
8. Mewtwo: A1-128(+1) / B4-70(+1)
9. Charizard ex: A1-36(+5) / A2b-10(+3)
10. Umbreon: A3b-43(+3) / B3a-37; Lucario: A2-92(+3) / B3-80; Pikachu: 9 grupos.
Implicancia: el límite de 2 por nombre debe sumar sobre todos los grupos del nombre; la disponibilidad se calcula por grupo.

## 2. Nombres en español

### 2.1 Algoritmo (`frontend/src/lib/utils.ts:55-89`)
- `pokémon`: `key = (ex ? name.slice(0,-3) : name).toLowerCase()`; `pokemon_translations[key][lang] || name`; si `ex`, reagrega `' ex'`.
- `trainer` con `evolution_type` item/tool/stadium → `tools_translations[name.toLowerCase()][lang] || name`; supporter → `trainers_translations`; otro → inglés.
- Claves de idioma: `en-US, fr-FR, es-ES, pt-BR, it-IT, de-DE` (`sync-card-translations.js:6`). La UI pasa `i18n.language` (`ExportWriter.tsx:18`).

### 2.2 Archivos
| Archivo | claves | es-ES null | pt-BR null |
|---|---|---|---|
| pokemon_translations.json | 1153 | 0 | 899 |
| tools_translations.json | 81 | 0 | 0 |
| trainers_translations.json | 82 | 0 | 1 |
46 claves de Pokémon no las usa ninguna carta (pre-sembradas: nincada, ninjask, shedinja, glalie, deoxys, ..., ogerpon, pecharunt). `sync-card-translations.js` solo agrega claves faltantes con en-US y `null` en el resto; **no está en la cadena `pnpm scraper`** (`package.json:11`): los nombres es-ES de un set nuevo se cargan a mano (PR #1037 agregó 4; commit fd752244 "es-ES backfill").

### 2.3 Comparación con el CSV
Reimplementé el algoritmo y lo corrí sobre las 4.317 cartas contra `CardName`: **4.317 coincidencias, 0 discrepancias**. **0 cartas caen al inglés** (ninguna clave faltante, ningún es-ES null). 3.572 cartas tienen es == en legítimamente (Pikachu, Mewtwo...). 0 colisiones (dos nombres EN distintos → mismo ES). Ningún nombre es-ES contiene coma (importa para el CSV).

Nombres especiales (EN → ES): Type: Null → Código Cero; Team Rocket's X → "X del Team Rocket" (59 cartas; p. ej. Team Rocket's Moltres ex → Moltres del Team Rocket ex, Team Rocket's Master Plan → Plan Maestro del Team Rocket, Thieving Machine → Robomatón del Team Rocket, Goo-zooka → Babazuca del Team Rocket, Researcher → Investigación del Team Rocket, Boss → Jefe del Team Rocket); Galarian X → "X de Galar"; Alolan X → "X de Alola" (Alolan Muk ex → Muk de Alola ex); Paldean → "de Paldea"; Hisuian → "de Hisui"; Mega Charizard X/Y ex → **Mega-Charizard X ex / Mega-Charizard Y ex** (todos los Mega llevan guion en ES); Origin Forme Palkia/Dialga → Palkia/Dialga Forma Origen; Castform Sunny/Rainy/Snowy Form → Castform Forma Sol/Lluvia/Nieve; Nidoran♀/♂ y Farfetch'd sin cambios; fósiles: Helix → Fósil Helix, Dome → Fósil Domo, Old Amber → Ámbar Viejo, Skull → Fósil Cráneo, Armor → Fósil Coraza, Plume → Fósil Pluma, Cover → Fósil Tapa, Jaw → Fósil Mandíbula, Sail → Fósil Aleta, Claw → Fósil Garra, Root → Fósil Raíz; Rotom formas: Rotom Calor/Lavado/Frío/Corte/Ventilador; Rotom Dex → RotomDex; Iono → e-Nigma; Lillie → Lylia; Copycat → Copiona; Rare Candy → Caramelo Raro; Dawn Wings/Dusk Mane Necrozma → Necrozma Alas del Alba / Melena Crepuscular; Ultra Necrozma ex → Ultra-Necrozma ex.

### 2.4 Texto de ataques/habilidades en español
**No existe en el repo.** `image-locales.json` (`scripts/generate-image-locales.ts:9-11`) es un manifiesto `{card_id: bitmask}` sobre `['en-US','es-ES','fr-FR','de-DE','it-IT','pt-BR']` que dice qué **imágenes** localizadas existen en `frontend/public/images/<locale>/`: 4.319 entradas (2 imágenes huérfanas), 1.778 con bit es-ES (1.777 con las 6 locales = 63), 1.791 solo en-US. `frontend/public/locales/es-ES/` son strings de UI; `common/sets.json` y `common/packs.json` tienen los nombres oficiales ES de sets y sobres (Genes Formidables, La Isla Singular, Pugna Espaciotemporal, Sobre Deluxe ex, Megaascenso, Fuego Carmesí, Desfile de Ensueño, Encantos de Paldea, Megavariocolor, Aura Pulsante, Impulso Paradójico, Maravillas Cotidianas...), útiles para M1.

## 3. Semántica del CSV (calculado sobre el archivo real)

Formato: BOM UTF-8 sí; separador de registro **LF** (sin CRLF); sin salto final; sin comillas; cabecera exacta `Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected`; 4.317 filas de datos. **El orden de filas es idéntico al de cards.json (fila i ↔ cards[i], 4317/4317)**, e `InternalId`, `Rarity`, `Pack`, `Expansion` coinciden fila a fila con el catálogo (0 diferencias). 0 Ids del CSV fuera de cards.json y 0 cartas de cards.json ausentes del CSV.

Valores: Collected TRUE 2.418 / FALSE 1.899. NumberOwned: 0: 1900, 1: 940, 2: 638, 3: 402, 4: 240, 5: 125, 6: 37, 7: 21, 8: 10, 9: 1, 10: 3.

Dedupe: 3.866 InternalId distintos; **450 InternalIds repetidos en 901 filas; en los 450 casos NumberOwned y Collected son idénticos** (esperable: `ExportWriter.tsx:20-24` lee `ownedCards.get(internal_id)` para ambas filas). 371 de esos 450 tienen NumberOwned > 0, o sea **371 grupos funcionales quedarían sobrecontados si se suma sin deduplicar**. Suma total ingenua 5.495 vs deduplicada **4.520** cartas. Collected TRUE: 2.418 filas → 2.046 ids distintos. 1 fila con NumberOwned 0 y Collected TRUE (B1a-28): **`Collected` es una bandera independiente ("carddex"), no se deriva de la cantidad**; 0 filas con cantidad > 0 y FALSE.

Copias jugables (dedupe por InternalId, luego suma por `alternate_versions`); entre paréntesis la suma ingenua:
| Carta | Grupo (card_ids = mismo id → cantidad) | Jugables |
|---|---|---|
| Mega Mawile ex B2-113 (Mega-Mawile ex) | B2-113=B4b-157 (924739)=1, B2-188 (929541)=0, B2-201 (930373)=1, B4a-108 (1383177)=0 | **2** (ingenua 3) |
| Small Balloon B3b-64 (Globito) | B3b-64=B4b-206 (1249281)=0, B3b-106 (1251980)=0, B4b-372 (1465601)=2 | **2** (2) |
| Bulbasaur A1-1 | A1-1=A4b-1 (65600)=2, A1-227 (80068)=1, A3-210 (406664)=0, A4b-2 (721024)=0, P-A-23 (12584400)=0 | **3** (5) |
| Latias A4a-36 | A4a-36 (657666)=3, B2-216=0, P-A-101=0 | **3** (3) |
| Latios A4a-37 | A4a-37 (657730)=1, A4a-75=0, B2-217=0 | **1** (1) |
| Hoopa ex B4-103 | B4-103=B4b-149 (1317315)=1, B4-186=0, B4-199=0 | **1** (2) |
| Espeon ex A4-83 | A4-83=A4b-160 (595139)=1, A4-190=0, A4-205=0, B2-228=0 | **1** (2) |
| Riolu A2-91 | A2-91 (202432)=1 | **1** (1) |
| Riolu B3-79 | B3-79=B4b-126 (1119168)=5, B3-169 (1124932)=1, B4b-318 (1462144)=1 | **7** (12) |
| Sabrina A1-225 | A1-225=A4b-338 (79937)=1, A1-272=0, A4b-339=0 | 1 |
| Mega Sharpedo ex B4-35 | todo 0 | 0 |
Totales: 1.229 grupos con ≥2 copias, 1.843 con ≥1, 476 con 0 (de 2.319).

**Atención:** este CSV ("(2).csv") da Globito = 2, Espeon ex = 1 y Mega-Sharpedo ex = 0, que son los valores que `guia_del_proyecto.md:85-86` atribuye al CSV **viejo** del proyecto, no a la exportación del 5/10 (Globito 3, Espeon 2, Sharpedo 1 según `BRIEF.md:160` y la guía). Los fixtures de arriba valen para este archivo; los criterios de aceptación del brief se escribieron contra otro.

## 4. Round-trip exportar/importar

**Exportación** (`pages/export/components/ExportWriter.tsx:14-30`): `allCards.map` → `{Id: card_id, CardName: getCardNameByLang(card, i18n.language), InternalId, NumberOwned: ownedCards.get(internal_id)?.amount_owned ?? 0, Expansion, Pack, Rarity, Collected: ...?.collected ?? false}` → `XLSX.utils.json_to_sheet` → `book_new` → `XLSX.writeFile(book, 'tcgcollectiontracterexport.csv')`. Librería `xlsx` 0.20.3 (`frontend/package.json:59`, tarball de cdn.sheetjs.com). Según la doc de SheetJS (write-options): "For compatibility with Excel, csv output will always include the UTF-8 byte order mark"; sheet_to_csv usa FS `,` y RS `\n`, y entrecomilla solo campos que contengan separador (confirmado empíricamente en el archivo: BOM, LF, sin comillas, booleanos como `TRUE`/`FALSE`). Una fila por carta de cards.json, en su orden; las gemelas enlazadas repiten cantidad.

**Importación** (`pages/import/components/ImportReader.tsx`): `XLSX.read(ArrayBuffer)` → primera hoja → `sheet_to_json` (líneas 56-58); exige que la **primera fila** tenga las claves `Id, InternalId, NumberOwned, Collected` (líneas 60-69; `CardName/Expansion/Pack/Rarity` se ignoran) y al menos 1 fila. `processFileRows` (25-38): para **todas** las filas arma `{internal_id, amount_owned: Math.max(0, Number(NumberOwned)), collected: Collected}` y llama `updateCards` una sola vez; luego, para las filas con `!Collected`, `setCollected(ids, false)`. `collectionService.updateCards` (78-143) deduplica por internal_id **quedándose con la primera aparición** (línea 99, comentario "needed for card csv import feature"), conserva `amount_wanted` existente, y hace **un único `upsert`** a `card_amounts` (sin chunking; `setCollected` sí chunkea de a 400). Por tanto:
- `Collected FALSE` **no borra**: la fila queda con su `amount_owned` y `collected=false`.
- `NumberOwned 0` se upsertea como 0 (no se borra la fila).
- Cartas ausentes del CSV no se tocan (pese al aviso de UI "OVERWRITE").
- InternalIds desconocidos se insertan sin validar contra cards.json (filas huérfanas).
- `NumberOwned` no numérico → `NaN` → el upsert falla con error (toast).
- `Collected` vacío/undefined → `!undefined` = true → se marca no coleccionada.
- SheetJS parsea CSV con `raw:false` por defecto (doc parse-options: "If the raw option is true, value parsing will be suppressed"), o sea `TRUE/FALSE` → booleanos y números → números; no pude ejecutar SheetJS acá (no está instalado) así que esto queda como lectura de documentación + consistencia con `!r.Collected`.

**Lo que debe producir nuestro exportador** para importar sin errores ni pérdida: las 8 columnas en el orden del tracker (mínimo las 4 obligatorias, con esos nombres exactos y en la primera fila); una fila por `card_id` de cards.json en su orden; `InternalId` entero del catálogo; `NumberOwned` entero ≥ 0; `Collected` literal `TRUE`/`FALSE`; **filas que comparten InternalId con valores idénticos** (el dedupe toma la primera, pero `setCollected` usa TODAS las FALSE: si una gemela dice TRUE y otra FALSE, gana FALSE); UTF-8 con BOM y LF para ser byte-idéntico al del tracker (SheetJS detecta ambos); `CardName` con el nombre es-ES del algoritmo 2.1 (cosmético). Nada se pierde en el ciclo: `amount_wanted` se preserva en el servidor; `collected` y `amount_owned` viajan por fila. Para "importar, exportar, reimportar sin diferencias" basta con normalizar al dedupe por InternalId antes de comparar.

## 5. Proceso de actualización del catálogo

**Fuentes del tracker**: cartas e imágenes desde `https://pocket.limitlesstcg.com/cards/<ID>` y cada `/cards/<ID>/<nr>` (`scraper.ts:12,477`), imágenes con fallback a `serebii.net/tcgpocket/<slug>/<nr>.jpg` cuando el CDN de Limitless da 403 (`scraper.ts:155-177`); Promo-B faltantes desde Serebii + pokemongohub (`backfill-promo-b.ts`); banners de set desde `s3.limitlesstcg.com/pocket/sets/<ID>.webp` (`download-packs.js:35`); misiones desde `pokemon-zone.com/themed-collections` vía curl por Cloudflare (`scrape-missions.ts:8,21`). Cadena `pnpm scraper` (`package.json:11`): scraper → backfill-promo-b → download-packs → generate-scan-hashes → generate-image-locales → sql/generate-cards-table → lint. `sync-card-translations.js` y `scrape-missions.ts` quedan fuera (manuales).

**Qué cambia al salir un set** (`.claude/skills/add-set/SKILL.md` + PRs #989 B4, #1001 B4a, #1037 B4b):
- `frontend/src/types/index.ts` → `expansionIds` (nuevo id al frente)
- `frontend/src/lib/CardsDB.ts` → entrada en `expansions` con `internalId`, `packs[]`, `tradeable`, `openable`, `packStructure {containsShinies, containsBabies, containsLinkedCards, cardsPerPack}`
- `scripts/scraper.ts` → `packs[]` y `rarityOverrides[ID]` (rangos ✵/✵✵ que Limitless etiqueta mal)
- `frontend/public/locales/{6}/common/sets.json` y `packs.json`
- `frontend/assets/cards.json` (**y filas de sets viejos**: PR #1037 fue +12106/−348 porque los `alternate_versions` de las cartas B1..B4a ganaron los ids de B4b), `*_translations.json`, `image-locales.json`, `public/hashes/en-US/hashes.json`, `public/images/en-US/*.webp` (95 archivos en #1037 por página de API), `public/images/sets/en-US/<ID>.webp`, `scripts/sql/output/bulk-insert.sql`, `biome.json` (maxSize), y después `themed-collections/<ID>-missions.json` en PR aparte (B4b aún no tiene).
- Además, los re-scrapes y correcciones de rareza **cambian internal_ids de cartas existentes**: PR #999 (B4 re-encoding, 46 cartas ☆ mal etiquetadas como ✵), migración `2026-08-b4a-rarity-remap.sql` (B4a-67/68/69/72), cache key `tcg_collection_cache_v6` (`collectionService.ts:6-11`). `internal_id` NO es inmutable en la práctica.

**Frecuencia** (`gh api .../commits?path=frontend/src/lib/CardsDB.ts`): 85 commits desde 2025-02-06. Altas de set: A2 2025-02-28, A2b 03-27, A3 04-30, A3a 05-29, A3b 06-26, A4 07-30, A4a 08-28, A4b 10-03, B1 10-30, B1a 12-17, B2 2026-01-29, B2a 02-26, B2b 03-26, B3 04-28, B3a 05-28, B3b 06-30, B4 07-30, B4a 08-28, B4b 10-01: **~1 set por mes**, alternando grande/mini, y el tracker lo publica 1-3 días después del lanzamiento. `cards.json`: 32 commits desde 2025-10-20 (~2,7/mes, incluye fixes sin set nuevo).

**Propuesta de sync para nuestra app** (commit fijado, re-ejecutable):
- URLs raw (base `https://raw.githubusercontent.com/marcelpanse/tcg-pocket-collection-tracker/3ab58f1cec6a03e3e85455cf7aade3bb8561f92e/`): `frontend/assets/cards.json` (3,1 MB), `frontend/assets/pokemon_translations.json`, `frontend/assets/trainers_translations.json`, `frontend/assets/tools_translations.json`, `frontend/src/lib/CardsDB.ts`, `frontend/src/types/index.ts`, `frontend/public/locales/es-ES/common/sets.json`, `frontend/public/locales/es-ES/common/packs.json`, y más adelante `frontend/assets/themed-collections/<ID>-missions.json`. Imágenes: enlazar `https://raw.githubusercontent.com/.../frontend/public/images/en-US/<card_id>.webp` (o es-ES si el bit de `image-locales.json` lo permite), no copiar.
- Parsear `expansions` de CardsDB.ts: **recomiendo la API del compilador `typescript`** (ya será devDependency): `ts.createSourceFile` → buscar la `VariableDeclaration` llamada `expansions` → `initializer.getText()` → `new Function('return ' + text)()` (el literal es JS válido: solo objetos, strings, números, booleanos y comentarios) → validar con zod. Probé la variante regex `/export const expansions: Expansion\[\] = (\[[\s\S]*?\r?\n\])\r?\n/` + `new Function`: devuelve las 24 expansiones correctas (`A4b:11/4L!o`, `B4b:22/4L!o`, `P-A:192`, `P-B:193`) y lo mismo para `craftingCost` (`{◊:35, ◊◊:70, ◊◊◊:150, ◊◊◊◊:500, ☆:400, ☆☆:1250, ☆☆☆:1500, Crown Rare:2500}`); sirve de fallback pero se rompe si cambian la anotación de tipo. Descarto ts-morph (dependencia extra sin ganancia) y ejecutar el módulo con tsx (tiene top-level `await import('../../assets/cards.json')` y alias `@/types`).
- Qué guardar: `catalog_sync {commit_sha, fetched_at, sha256 por archivo, cards_count}`; `expansions {id PK, internal_id, name, tradeable, openable, promo, cards_per_pack, contains_shinies, contains_babies, contains_linked_cards, packs[] (name,color), name_es, name_en}`; `cards {card_id PK, expansion, number, internal_id, deckbuilding_id = alternate_versions[0], name_en, name_es (precalculado con 2.1), hp, energy, card_type, evolution_type, rarity, ex, baby, pack, artist, attacks json, ability json (efecto limpio de "Illustrated by"), weakness, retreat, image_url, search_text}` + `card_alternate_versions (card_id, internal_id, position)`; guardar los archivos crudos para reproducibilidad. Identidad = `card_id`; `internal_id` es atributo versionado: al cambiar de commit, diffear `card_id → internal_id` y remapear colección/mazos (como hace la migración del tracker).
- Detectar set nuevo: cron que consulta `GET /repos/marcelpanse/tcg-pocket-collection-tracker/commits?path=frontend/src/types/index.ts&per_page=1` (o `CardsDB.ts`) y compara el sha con el fijado; si cambió, bajar `types/index.ts` del nuevo sha y comparar `expansionIds` → aviso "hay set nuevo B5 en el tracker; revisar y subir el pin". El pin se sube a mano porque un re-scrape puede renumerar ids.

## 6. `containsLinkedCards`

- `grep` sobre `frontend/src`: aparece solo en `types/index.ts:127` (tipo `PackStructure`) y en `CardsDB.ts` (datos: true en A1a:62, A4b:200, B4b:359). **`stats.ts` no lo lee** (usa `cardsPerPack` en 101/182/207/213/231 y `containsShinies`/`containsBabies`); ningún componente lo usa. El único consumidor es `scripts/scraper.ts:382,400`.
- Origen: commit e0b0d090 (2026-02-27) "fix: #855 Penny and Iono incorrectly marked as reprints". Issue #855: B2a-89 Iono y B2a-92 Penny ◊◊ (arte alternativo en un set normal, que el juego trata como cartas distintas) fueron fusionadas por el scraper con A2b-69/A3b-69 porque Limitless las listaba como "versiones" de igual rareza; marcelpanse: "add a new property on the set definition ... `containsReprints` ... true in the case of the Deluxe pack, but false in this case. When set to false, we shouldn't do the linking". El diff del commit agrega exactamente `baseCardNr = alternate_card_id && containsLinkedCards ? ...cardNr : inPackId`.
- Significado: "las reimpresiones de igual rareza de este set son la MISMA carta en el juego: compartir internal_id y, por lo tanto, cantidad". Historia previa: PR #167/#169 (2025-02-18, `linkedCardID` para Ámbar Viejo A1a-63), issue #306 (Old Amber: "I decided eventually to just don't display the linked card"), issue #673 (A4b: "packs contain old cards, however they seem to be treated as new cards ... In the game they are treated as separate cards. But if you click on one of the versions, it shows as one card"; pokemon-zone: las cartas del Deluxe no se registran en el Dex de las expansiones anteriores). O sea, es una decisión de modelado (contar una sola vez), no una mecánica de sobre.
- **Para probabilidades es dato muerto.** El sobre de 4 cartas se modela por `cardsPerPack === 4` con `deluxePackProbabilities` (`stats.ts:69-83`): pos1 ◊ 100; pos2 ◊ 17,73 / ◊◊ 82,27; pos3 ◊ 23,021, ◊◊ 17,985, ◊◊◊ 40,659, ☆ 12,858, ☆☆ 2,5, ☆☆☆ 1,111, ✵✵ 1,667, Crown 0,198; pos4 ◊◊◊◊ 100; sin rare pack ni baby (`stats.ts:231-233`). Las fuentes web solo confirman "4 cartas, una ex garantizada" (nintendolife, pokemongohub, pokemon-zone), no tablas. Lo que sí implica para M4: en un Deluxe, una carta buscada del grupo X se puede sacar como gemela enlazada (mismo internal_id que la original, `missingIds.has(c.internal_id)` la cuenta igual) o como foil de la segunda tanda (id propio, solo la cuenta `deckbuildingMode` vía `alternate_versions`, `stats.ts:178-180`); el denominador `nrOfcardsOfThisRarity` cuenta filas del set, foils incluidas. Portar tal cual; guardar `containsLinkedCards` como metadato de set porque documenta por qué A4b/B4b comparten ids.

## 7. `MissionsDB.ts` y `themed-collections` (para más adelante)
`MissionsDB.ts:5-17` carga con `import.meta.glob` todo `assets/themed-collections/*-missions.json` filtrando por `expansionIds`. 21 archivos (A1..B4a; **B4b todavía no**, PR #1037 lo deja para después), 445 misiones: A1 26 (7 secretas), A1a 17, A2 24, A2a 17, A2b 40, A3 33, A3a 14, A3b 12, A4 28, A4a 17, A4b 29, B1 33, B1a 16, B2 28, B2a 16, B2b 17, B3 19, B3a 14, B3b 11, B4 15, B4a 19. Estructura: `{expansionId, name, requiredCards: [{options: [card_id...], amount}], reward (HTML con <br />), secret}`; `utils.ts:154-160` clasifica normal/secret/complete por el nombre. `stats.ts:142-172` calcula probabilidad por misión. Se scrapean de pokemon-zone (Cloudflare, vía curl).

## 8. Deck builder del tracker (`frontend/src/pages/decks/*`)
- Modelo `Deck` (`types/index.ts:205-216`; `schema.sql`: `decks.cards integer[]`, `energy varchar(24)[]`, `name varchar(64)`): `{id, email, is_public, name, energy: Energy[] (solo los 8 tipos básicos; sin dragón/incoloro), cards: number[] (20 internal_ids con repeticiones), created_at, updated_at}`. Los ids guardados son el **deckbuilding_id** (en modo deckbuilding `filters.ts:79` solo muestra `internal_id === alternate_versions[0]` y `addCard(card.internal_id)`).
- Validación (`DeckBuilder.tsx:94-101`, zod): nombre ≥ 4 caracteres, ≥ 1 energía, `cards.length === 20`. Máximo 2 copias solo por UI (botón + deshabilitado con `amount >= 2`, líneas 222 y 327) y **por id de grupo, no por nombre** (Riolu A2-91 + Riolu B3-79 → 4 permitidas). Sin regla de Básico, sin líneas evolutivas, sin coherencia de energías. Es un subconjunto de nuestras reglas de la sección 2 del brief.
- Reutilizable para M3: `utils.ts:12-14` `getDeckbuildingCopies` (suma `amount_owned` sobre `alternate_versions`), `getMissingCardsCount` (16-25), `getOwnedStatus` (27-39: marca cada copia como tenida/faltante en orden Pokémon→item→tool→supporter→stadium) y `selectBuildableDecks` (`deckService.ts:107-122`, filtro "puedo armarlo" client-side). Sin historial ni etiquetas ni importación de texto.

## 9. Fixtures sugeridos (todos calculados arriba)
cards.json: 4317 filas; 3866 ids; 450 ids compartidos / 901 filas / 1 trío; 2319 grupos; 1383 nombres; 555 nombres multigrupo; 453 filas con id foráneo (B4b 236, A4b 214, B2a 2, A1a 1); A4b 214+165 (139 foils emparejadas), B4b 236+193 (166 foils en 237-402); overrides 133058/12583248/12583376; Copycat/Copiona grupo [800833, 803717, 1466817, 1468933] (B1-225, B1-270, B4b-225, B4b-391, B4b-424). CSV: 4317 filas, orden = cards.json, ingenua 5495 / deduplicada 4520, 371 grupos sobrecontados, B1a-28 (0, TRUE); jugables: Mega-Mawile ex 2, Globito 2, Bulbasaur A1-1 3, Latias 3, Latios 1, Hoopa ex 1, Espeon ex 1, Riolu A2-91 1, Riolu B3-79 7, Sabrina 1, Mega-Sharpedo ex 0; grupos ≥2: 1229, ≥1: 1843, 0: 476. es-ES: 4317/4317, 0 fallbacks, 3572 iguales al inglés.

## Recomendaciones
1. **Identidad por `card_id`, `internal_id` como atributo versionado.** Guardar `(card_id, internal_id, deckbuilding_id = alternate_versions[0])` y, al subir el commit fijado, diffear `card_id → internal_id` y remapear colección/ajustes/mazos antes de aplicar (el tracker ya lo tuvo que hacer dos veces en 2026). No decodificar `internal_id` con la fórmula para obtener `card_id` (B2a-89/B2a-92 son ids huérfanos).
2. **Conteo de copias** = `dedupe por internal_id` → `suma por alternate_versions`. Implementarlo como función pura con los fixtures de la sección 9. Para "máximo 2 por nombre", sumar sobre todos los grupos del mismo `name` (555 nombres multigrupo).
3. **Nombres ES**: portar `getCardNameByLang` tal cual (3 JSON + regla `' ex'`) y precalcular `name_es` al sincronizar; indexar búsqueda por `name_en`, `name_es`, `card_id` y texto (limpiando `Illustrated by...` de `ability.effect` en trainers). Para "Copiona" ↔ "Copycat" alcanza con eso.
4. **Exportador**: 8 columnas en el orden del tracker, orden de cards.json, BOM + LF, `TRUE/FALSE`, gemelas con valores idénticos; test de round-trip que compare tras dedupe por InternalId. **Importador propio**: aceptar BOM y CRLF, validar Ids contra el catálogo (el tracker no lo hace), tratar `Collected` como bandera independiente, mostrar el diff antes de aplicar.
5. **Sync del catálogo**: fetch raw a commit fijado (lista de URLs en 5), parseo de `expansions`/`craftingCost` con la API de `typescript` + `new Function` validado con zod (regex como fallback), hash de cada archivo, upsert completo (un set nuevo también modifica filas viejas). Cron que compara el sha de `types/index.ts` en `main` contra el pin y avisa cuando aparece un `expansionId` nuevo; el pin se sube a mano.
6. **`containsLinkedCards`**: guardarlo como metadato de set, no usarlo en probabilidades; portar `stats.ts` con `cardsPerPack === 4` y las tablas Deluxe literalmente.
7. **Rehacer los fixtures de aceptación de M2 con la exportación del 5/10** (Globito 3, Espeon ex 2) o aceptar que el CSV "(2)" es el viejo; conviene que el usuario suba la nueva al proyecto.
8. Para M3 reutilizar la idea de `getOwnedStatus`/`getDeckbuildingCopies`, pero las reglas del tracker son insuficientes (no valida Básico, evoluciones ni 2 por nombre).

## Riesgos
- **Cambios de `internal_id` entre commits del tracker** (re-scrapes, correcciones de rareza: PR #999, migración 2026-08-b4a). Impacto: colección y mazos con ids huérfanos. Mitigación: identidad por `card_id`, diff + remapeo automático al cambiar el pin, test que falle si un `card_id` cambia de `internal_id`.
- **Los sets nuevos reescriben filas viejas** (`alternate_versions` de B1..B4a cambiaron con B4b). Impacto: grupos funcionales desactualizados si solo se insertan cartas nuevas. Mitigación: upsert completo y recomputar `deckbuilding_id` en cada sync.
- **Ruido de scraping en cards.json**: `damage` con palabras, `Illustrated by` pegado en trainers, `pack` = `everypack` para todos los sets mono-sobre desde A2b, `hp` solo en algunos fósiles. Impacto: búsquedas y simulador (deckgym no usa esto, pero nuestra UI sí). Mitigación: normalizar al importar y testear con los 18 grupos de trainers.
- **Nombres es-ES de un set nuevo pueden llegar `null`** (sync-card-translations no corre en `pnpm scraper`; se rellenan a mano). Impacto: fallback al inglés. Mitigación: contar fallbacks en cada sync y avisar; permitir override local de nombres.
- **No hay texto de reglas en español en ninguna fuente del repo.** Impacto: M1 "búsqueda por texto" será en inglés salvo que se agregue otra fuente. Mitigación: aceptar inglés en Fase 1 o evaluar pokemon-zone/Serebii ES (licencia/estabilidad desconocidas).
- **SheetJS no se ejecutó localmente**: el comportamiento de parseo (`TRUE/FALSE` → booleano, BOM) se tomó de la documentación y del archivo real. Mitigación: probar una importación real en el tracker con nuestro CSV antes de cerrar M2.
- **Dependencia del tracker como fuente única** (un repo personal GPL-3.0, Supabase; Limitless cambia su HTML). Mitigación: cachear los archivos crudos por commit; documentar en LICENCIAS.md que los datos vienen de GPL-3.0.
- **CSV de referencia desactualizado** ("(2).csv" es anterior al del 5/10). Mitigación: pedir la exportación actual antes de fijar fixtures de aceptación.

## Preguntas abiertas
1. ¿`tcgcollectiontracterexport (2).csv` es realmente tu exportación más nueva? Sus valores (Globito 2, Espeon ex 1, Mega-Sharpedo ex 0) coinciden con el CSV "viejo" que describe `guia_del_proyecto.md` §6, no con el del 5/10 que menciona el brief. ¿Podés subir la actual (o confirmar cuál manda para los criterios de aceptación)?
2. ¿Querés que las copias jugables consideren también las foils con id propio de los Deluxe (p. ej. B4b-372) como hace el tracker (sí, vía `alternate_versions`), o preferís distinguir "mismo sobre/dex" para misiones? Hoy el tracker suma todo.
3. ¿Aceptás texto de ataques/habilidades solo en inglés en Fase 1 (no hay fuente ES en el repo), o querés que investigue una fuente externa en español?
4. ¿La sincronización del catálogo debe ser 100 % automática al detectar un commit nuevo, o preferís aviso + aprobación manual del pin (recomendado, porque los re-scrapes pueden cambiar ids)?
5. Para el límite "2 por nombre": ¿los nombres se comparan en inglés (`name` del catálogo) o en español? Son equivalentes 1:1 (0 colisiones), pero conviene fijar uno como canónico.

## Fuentes
**Archivos locales (refs/tracker @ 3ab58f1):**
- `frontend/assets/cards.json` (4.317 filas, 3.115.177 bytes), `pokemon_translations.json`, `trainers_translations.json`, `tools_translations.json`, `image-locales.json`, `themed-collections/*-missions.json`
- `scripts/encoder.ts:4-59` (fórmula y tabla de rarezas); `scripts/scraper.ts:12,18-47,62-137,139-140,155-177,205-243,245-262,283-447,494-517`; `scripts/sql/generate-cards-table.ts:26-60`; `scripts/sync-card-translations.js:6,23-40,58-118`; `scripts/download-packs.js:9-38`; `scripts/generate-image-locales.ts:9-18,35-62`; `scripts/backfill-promo-b.ts:17-22,289-336`; `scripts/scrape-missions.ts:8-21`; `scripts/sql/migrations/2026-08-b4a-rarity-remap.sql:1-17`, `2026-09-add-deckbuilding-id.sql`; `scripts/sql/schema.sql` (tablas `decks`, `card_amounts`, `cards_list`); `package.json:11`
- `frontend/src/lib/CardsDB.ts:1-29,31-382,384-407`; `frontend/src/lib/utils.ts:55-89,152-160`; `frontend/src/lib/stats.ts:23-118,120-140,174-251`; `frontend/src/lib/MissionsDB.ts:5-23`; `frontend/src/lib/imageLocales.ts`; `frontend/src/lib/filters.ts:62,79,154-160`; `frontend/src/types/index.ts:5-45,124-145,147-188,205-216`
- `frontend/src/pages/export/components/ExportWriter.tsx:14-30`; `frontend/src/pages/import/components/ImportReader.tsx:25-38,53-79`; `frontend/src/services/collection/collectionService.ts:6-11,78-143,187-216`; `frontend/src/pages/decks/utils.ts:4-59`; `frontend/src/pages/decks/DeckBuilder.tsx:94-101,108-121,215-222,303-327`; `frontend/src/services/decks/deckService.ts:84-122`; `frontend/src/pages/overview/Overview.tsx:70,161`; `frontend/package.json:59`; `frontend/public/locales/es-ES/common/sets.json`, `packs.json`, `pages/import.json`
- `.claude/skills/add-set/SKILL.md`; `CLAUDE.md` del tracker
- `C:\Users\<usuario>\Personal\tcg pocket\Docs\BRIEF.md:60-81,149-168`; `Docs\context\guia_del_proyecto.md:17-33,81-88`; `Docs\context\mazos_40_listas.md:1-60`
- CSV: `C:\Users\<usuario>\Downloads\tcgcollectiontracterexport (2).csv` (solo lectura)
- Scripts de análisis: scratchpad `analyze.mjs` y `out.json`

**GitHub (gh api / gh search):**
- https://github.com/marcelpanse/tcg-pocket-collection-tracker/commits?path=frontend/src/lib/CardsDB.ts (85 commits) y `?path=frontend/assets/cards.json` (32)
- PR #1037 (B4b, archivos y descripción), #1001 (B4a), #989 (B4), #674 (deluxe set support), #682 (refactor card structure), #167/#169 (linkedCardID)
- Commit e0b0d090 (`fix: #855 Penny and Iono incorrectly marked as reprints`, introduce `containsLinkedCards`); commit 2be6e3b4 (Linked card ID)
- Issues #855, #673 (Support for new deluxe set), #306 (Old Amber), #749/#754 (Pidgey/Luxray promos linked)

**Web:**
- SheetJS write options (BOM en csv): https://docs.sheetjs.com/docs/api/write-options
- SheetJS CSV utilities (FS/RS/quoting): https://docs.sheetjs.com/docs/api/utilities/csv
- SheetJS parse options (`raw`): https://docs.sheetjs.com/docs/api/parse-options
- Deluxe Pack ex (A4b) en pokemon-zone: https://www.pokemon-zone.com/sets/a4b/ y https://www.pokemon-zone.com/events/deluxe-pack-ex-release/
- Deluxe Pack: Mega anuncio: https://pokemongohub.net/post/tcg-pocket/pokemon-tcg-pocket-deluxe-pack-mega-announced/ ; https://www.nintendolife.com/news/2026/09/pokemon-tcg-pockets-next-expansion-has-a-guaranteed-rare-in-every-pack ; https://outof.games/news/10075-deluxe-pack-mega-comes-to-pokemon-tcg-pocket-from-september-29th-to-october-28th/

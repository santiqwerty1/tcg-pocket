> Informe de investigación automático de la Fase 0 (6/10/2026), generado por agentes de Claude Code sobre `refs/tracker` @ 3ab58f1, `refs/deckgym-core` @ fb792ebf, la API de Limitless y documentación pública. Las rutas `C:\Users\<usuario>\AppData\Local\Temp\...` son scripts descartables de la sesión. Los números de colección se calcularon con la exportación del 1/10/2026 que estaba en Descargas; el plan usa la del 6/10/2026 en `docs/context/`. Las secciones "Preguntas abiertas" quedaron consolidadas en `docs/PLAN.md` §8.

# deckgym

## Resumen
deckgym-core @ fb792ebf sirve como motor de M7 sin modificarlo, pero NO como CLI "caja negra": conviene un crate Rust propio (opción B) que dependa de `deckgym` como git dependency fijada al commit y exponga un CLI JSON-in/JSON-out, porque (1) el CLI `simulate` no emite nada legible por máquina (solo `warn!` a stderr con separadores de miles), (2) con `--seed` TODAS las partidas usan la misma semilla (simulate.rs:247) y salen idénticas, (3) `simulate` no valida el mazo (nunca llama `is_valid`) y (4) la estadística "atacante listo en turno N" exige un `SimulationEventHandler` propio.
Verificado con node sobre database.json y cards.json: los 4.317 ids mapean 1:1 al tracker (0 sin mapear, 0 diferencias de nombre/tipo/energía, 1 de HP en P-A 022, 600 de notación de rareza). Repliqué `card_status` parseando los mapas Rust: 4.271 completas / 46 incompletas, todas Entrenadores B4b (12 Objetos + 34 Partidarios) con "Trainer logic not implemented", igual que el brief; las 46 tienen una edición implementada con nombre y texto idénticos (21 comparten `internal_id` con la original en el tracker).
Formato de mazo: hay que emitir SIEMPRE `Energy:` explícito: con energía inferida un mazo todo Dragón (mazo 9) o todo Incoloro (mazo 10) hace panic en game.rs:178, y un mazo mixto con un Incoloro de relleno haría que la Zona genere Incoloro la mitad de las veces (state/mod.rs:1072). Empate: turno > 30 (state/mod.rs:742), 3 puntos simultáneos o ambos sin Pokémon; explica el 63 % de empates con bots al azar.
Jugar contra bot: implementar el trait público `Player` en nuestro crate (long-poll al servidor) en vez del puente stdin/stdout; WebAssembly exigiría modificar el motor (rayon, indicatif, env_logger, std::process, std::fs, Instant sin feature-gates). El viewer (React 19 + Pixi 8 + GSAP) es reutilizable como bundle estático: no necesita datos externos porque el replay lleva las definiciones de cartas; servirlo bajo /viewer implica código AGPL en nuestra app.

## Hallazgos
# deckgym-core como motor de M7 (análisis sin compilar; cargo no disponible)

Repo: `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core` @ `fb792ebfbaca995af9750c28101ce92a51282825` (merge PR #387, 4/10/2026). Tracker @ `3ab58f1` (1/10/2026). Todo lo que sigue se verificó leyendo código o con scripts node en el scratchpad (`ids_compare.js`, `card_status.js`); lo que no se pudo verificar sin `cargo build` se marca **[no verificado]**.

## 1. Ids y campos de `database.json` vs `cards.json` del tracker

**Estructura.** `database.json` es un array de 4.317 objetos con envoltorio serde externally-tagged: `{"Pokemon":{...}}` o `{"Trainer":{...}}` (`src/models/card.rs:158-162`). Ids con formato `^(P-[AB]|[AB]\d[a-z]?) \d{3}$` (24 sets: A1 A1a A2 A2a A2b A3 A3a A3b A4 A4a A4b B1 B1a B2 B2a B2b B3 B3a B3b B4 B4a B4b P-A P-B). Mapeo `'A1a 001' → 'A1a-1'`, `'P-A 001' → 'P-A-1'` (reemplazar último espacio por `-`, quitar ceros a la izquierda).

**Resultado del script (`ids_compare.js`):**

| Chequeo | Resultado |
|---|---|
| db → tracker | 4.317/4.317 mapeados, 0 sin destino |
| tracker → db | 4.317/4.317 cubiertos |
| `name` (inglés) | 0 diferencias |
| `hp` (Pokémon) | **1 diferencia: `P-A 022` deckgym 50 vs tracker 60** (no sé cuál es correcta; revisar contra la carta) |
| tipo de carta (Pokemon/Trainer vs pokémon/trainer) | 0 |
| `energy_type` vs `energy` | 0 |
| `rarity` | 600 diferencias, todas de notación: deckgym `*`/`**` vs tracker `✵`/`✵✵` (244+97); deckgym `♛` vs tracker `Crown Rare` (39); tracker usa `P` para 220 promos mientras deckgym conserva el símbolo impreso (`◊`, `☆`, …) |
| CSV real (4.317 filas, BOM UTF-8) | 4.317 `Id` mapean a un id deckgym |

Conclusión: **la clave de cruce es el id**; la rareza hay que normalizarla (o tomarla del tracker).

**Campos.** Pokémon (3.922): `id, name, stage (0:2157 / 1:1285 / 2:480), evolves_from (null ⇔ stage 0, 0 inconsistencias), hp, energy_type (incluye Dragon 113 y Colorless 520), ability {title, effect} (529 cartas), attacks[] {energy_required[], title, fixed_damage (número), effect (string|null; 2.327 de 4.055 ataques tienen efecto)}, weakness, retreat_cost[], rarity, booster_pack` (`src/models/card.rs:83-114`). Entrenador (395): `id, trainer_card_type, name, effect, rarity, booster_pack` (`card.rs:138-145`); `trainer_card_type` ∈ {Supporter 236, Item 59, Tool 53, Stadium 33, **Fossil 14**} (`card.rs:128-134`). Los fósiles se juegan como Básicos de 40 PS (`move_generation_trainer.rs:1066-1081`) pero `Card::is_basic()` devuelve false para ellos (`card.rs:274-279`), así que un mazo de solo fósiles + evoluciones haría panic en `shuffle` (`deck.rs:147`).

## 2. Estado de implementación (réplica de `card_status`)

**Reglas** (`src/card_validation.rs:39-76`):
- Pokémon: cada `attack.effect` no nulo debe ser clave de `EFFECT_MECHANIC_MAP` (`src/actions/effect_mechanic_map.rs:17`; **560 claves**, texto exacto del efecto) → si no, `MissingAttack`. `ability.effect` debe ser clave de `EFFECT_ABILITY_MECHANIC_MAP` (`effect_ability_mechanic_map.rs:12`, **157 claves**; `ability_mechanic_from_effect` en `:789-791`) → `MissingAbility`.
- Entrenador Tool: `is_tool_effect_implemented` compara el texto con el de 26 Tools de referencia (`src/tools.rs:33-84, 139-171`) → `MissingTool`.
- Resto: `trainer_move_generation_implementation(&State::default(), card)` devuelve `None` ⇒ `MissingTrainer` (`move_generation_trainer.rs:60-319`). Stadium: texto contra 13 estadios de referencia (`src/stadiums.rs:33-78`). Fossil: siempre `Some` (`:81-83`). **Cualquier otro Entrenador se decide por `match` sobre el enum `CardId` de la edición** (`:85-317`, 259 variantes en los brazos; `_ => None` en `:317`). Por eso las reimpresiones B4b faltan: nadie agregó sus variantes al `match`, aunque el texto sea idéntico.

**Réplica en node** (`card_status.js`: extrae los literales Rust de `map.insert("…"` con un parser de escapes, lee `CARD_ID_MAP` de `src/card_ids.rs:4329-8655`, los `CardId::` referenciados en `tools.rs`/`stadiums.rs` y en los brazos del `match` de `move_generation_trainer.rs:86-316`):

```
Total 4317 · Complete 4271 · Incomplete 46  { MissingTrainer: 46 }
por set { B4b: 46 } · por tipo { Item: 12, Supporter: 34 }
```
Coincide con el brief. Lista (ids deckgym): `B4b 198-203, 212-226, 364-369, 378-392, 421-424` = Lucky Ice Pop, Electric Generator, Order Pad, Quick-Grow Extract, Field Blower, Flame Patch, Iris, Juliana, Diantha, Calem, Puppy-Loving Girl, Korrina, Clemont, Serena, May, Skyla, Arven, Wallace, Wally, Copycat, Lisia, Elesa (varias ediciones cada una). Guardé el JSON en el scratchpad (`incomplete.json`).

**Formato exacto de `cargo run --bin card_status -- --incomplete-only`** (`src/bin/card_status.rs:56-133`, stdout):
```
ID       Name                Status
---------------------------------------------      (ancho = max_id + max_name + 20)
B4b 198  Lucky Ice Pop       Trainer logic not implemented
...
==================================================
Summary:
  Total cards:      46
  Complete:         0 (0.0%)
  Incomplete:       46 (100.0%)

  Breakdown by issue:
    Trainer logic not implemented: 46
```
Ojo: con `--incomplete-only` el resumen se calcula sobre las filas filtradas (`:157-160`), así que "Total cards" es 46, no 4.317; para el total hay que correrlo sin flag. Las cadenas de estado: `Fully implemented`, `Card ID not found`, `Attack effect not implemented`, `Ability not implemented`, `Trainer logic not implemented`, `Tool not implemented` (`card_validation.rs:27-36`); las filas completas muestran `✓ Complete` (`card_status.rs:79`). `--first-incomplete` imprime `"{id} - {name} ({desc})"` (`:143-149`). Parseo robusto para el worker: separar por 2+ espacios; o mejor, usar `get_implementation_status(CardId)` (pública) desde nuestro crate (ver §5).

**Mapeo a una edición implementada.** Verificado sobre las 46: todas tienen ≥1 edición con `kind`, `name`, `trainer_card_type` y `effect` idénticos ya implementada (p. ej. `B4b 198 → B2 145`, `B4b 199 → B2a 086/B2a 131`, `B4b 225 → B1 225/B1 270`, `B4b 422 Elesa → B3b 066/B3b 083`). Con el grupo `alternate_versions` del tracker también 46/46, **pero** hay una trampa: `alternate_versions` lista `internal_id`, y el `internal_id` no es único (3.866 distintos para 4.317 cartas): 21 de las 46 comparten su `internal_id` con la original (`B4b-198` = 926785 = `B2-145`), y un mapa `internal_id → carta` que se quede con la última ocurrencia oculta a la original. Hay que expandir `internal_id → [cartas]`. Estrategia recomendada para la app: carta funcional = mismo nombre + mismo texto en `database.json`; al exportar a deckgym elegir la edición implementada de menor rareza; cruzar con el grupo del tracker como control.

## 3. Formato de mazo (`src/deck.rs`)

- `Deck::from_string` (`:43-96`): por línea, `trim`; salta vacías y las que empiezan con `"Pokémon:"` (con acento; `"Pokemon:"` sin acento NO se salta y falla como carta inválida) o `"Trainer:"` (`:49-54`). `Energy:` (`:55-74`): lista separada por comas, nombres en inglés exactos (`Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Dragon, Colorless`, `card.rs:39-53`); energía desconocida ⇒ **panic** `Invalid energy type` (`:71`), lista vacía ⇒ `Err`.
- Línea de carta `Card::from_str_with_count` (`:161-181`): `split_whitespace`, `parts[0]` = cantidad (u32), set = penúltimo token, número = último, rellenado a 3 dígitos (`format!("{number:0>3}")`, `:173`); el nombre se ignora. `"2 Zorua B3 105"`, `"2 Poké Ball P-A 5"`, `"1 Giovanni A4b 334"` son válidos. Id inexistente ⇒ `Err("Card ID not found for id: …")`; `Simulation::new` lo convierte en panic `Failed to create simulation` (`simulate.rs:400-409`, exit 101, mensaje en stderr).
- **Inferencia de energía** si falta `Energy:` (`:81-87`): unión de `energy_type` de todos los Pokémon, **incluidos Dragon y Colorless**, ordenada (`:89-90`).
- `is_valid` (`:98-125`): 20 cartas, ≥1 básico, energías no vacías y todas seleccionables (Dragon/Colorless no, `card.rs:61-63`), ≤2 copias por nombre. **Pero `simulate` nunca llama `is_valid`**: solo lo usan `optimize` (`optimize.rs:285,465`), `card_test` y `temp_deck_generator`. El modo carpeta solo exige `cards.len()==20` (`main.rs:202`); el modo 1 vs 1 no exige nada: un mazo de 19 cartas o con 3 copias se simula igual (el único panic es sin básicos: `deck.rs:147`). **La app debe validar antes de encolar.**
- Consecuencias: `Game::get_color` hace **panic** si `energy_types[0]` es Dragon o Colorless (`game.rs:164-185`). Mazo 9 (A1 183 Dratini, B4 117 Dragonair, B4 120 Mega Rayquaza ex, B4 124 Drampa: los 4 son `energy_type: Dragon`, costos Fire+Lightning) ⇒ inferido `[Dragon]` ⇒ panic ⇒ emitir `Energy: Fire, Lightning`. Mazo 10 (B2 127, A3a 060/061, B4 144, B2 141, B1 206: todos Colorless, costos solo `[C]`) ⇒ panic ⇒ emitir `Energy: <un tipo seleccionable>` (cualquiera sirve para la simulación; en el juego también hay que elegir uno). Peor aún: un mazo Fuego con un Furfrou de relleno inferiría `[Fire, Colorless]` (Fire primero ⇒ no hay panic) y `roll_energy` elige uniforme entre los tipos (`state/mod.rs:1072-1077`) ⇒ la Zona generaría Incoloro el 50 % de las veces **en silencio**. Regla: **emitir siempre `Energy:`**.
- ¿Acepta el formato Limitless directamente? Acepta cualquier línea `N Nombre SET NUM` y cabeceras `Pokémon: N` / `Trainer: N`. Los dos example_decks con cabeceras (`venusaur-exeggutor.txt`, `weezing-arbok.txt`) tienen esa forma con números de 3 dígitos. No pude verificar el texto exacto que exporta Limitless (fuera de mi alcance; confirmar con el investigador de Limitless si la cabecera es exactamente `Pokémon:` con acento y si incluye líneas como `Energy` o totales).
- Copias: el parser no limita; `is_valid` sí (≤2 por nombre), pero no se aplica en `simulate`.
- **Fin de partida y empates:** `turn_count > 30` ⇒ `Tie` (`state/mod.rs:741-745`; turno global, 15 por jugador). Además empate si ambos llegan a 3 puntos en la misma acción y ambos tienen (o ninguno tiene) Pokémon (`apply_action_helpers.rs:885-908`) o si ambos se quedan sin Pokémon (`:920-923`). `StatsCollector` cuenta `None` como empate (`simulation_event_handler.rs:233`). Con bots al azar casi nunca se llega a 3 puntos en 30 turnos ⇒ el 63 % de empates del brief es el límite de turnos, no una regla del juego real.

## 4. Superficie programática

- `Simulation` (`src/simulate.rs:66-320`): `new(paths…)`/`new_with_decks(Deck, Deck, codes, n, seed, parallel, threads)`/`new_with_player_factory` (`:88-165`); `register::<T: SimulationEventHandler+Default>()` y `register_with_closure` (`:167-179`); `with_callback` (por partida, `:181-187`); `with_bots(bot_a, bot_b, timeout)` (`:192-201`); `run() -> Vec<Option<GameOutcome>>` (`:203-308`); `get_event_handler::<T>()` (`:311-313`); `game_ids()` (`:317-319`).
- **Semillas:** `let seed = self.seed.unwrap_or(rand::random())` **dentro del closure por partida** (`:247`): con `--seed` las N partidas reciben la misma semilla y, como todo el azar (barajado, moneda inicial `state/mod.rs:292`, `RandomPlayer` `random_player.rs:13-18`, MCTS, expectiminimax) sale del `StdRng` del `Game` (`game.rs:42-56`), **las N partidas son idénticas**. Sin `--seed`, cada partida es aleatoria e irreproducible; `--parallel` usa `rayon::into_par_iter` (`:276-280`) y los `game_id` son UUID v4. Mismo problema en `optimize.rs:324,347` y `python_bindings.rs:859`. Nuestro crate debe derivar `seed_i = base + i` y crear `Game::new(players, seed_i)` directamente (o `Simulation` con `num=1` por semilla).
- `SimulationEventHandler` (`src/simulation_event_handler.rs:25-55`): `on_simulation_end`, `merge` (obligatorio), `on_game_start(_with_metadata)` (seed, nombres, mazos), `on_action(game_id, state_before, actor, playable_actions, action)`, `on_action_note`, `on_game_end(game_id, State, Option<GameOutcome>)`. Una instancia por partida + merge al final (`:21-24`). `StatsCollector` → `ComputedStats` (`:145-158`): duración, turnos y plies promedio, grados por ply, victorias A/B, empates y tasas. `GameplayStatsCollector` (`src/gameplay_stats_collector.rs:12-23`): turno promedio en que se vacía el mazo, tamaño de mano promedio, **turno promedio de primera aparición en mesa por carta** y **turno promedio del primer uso de cada ataque** por (jugador, card_id, título); el "turno" es el conteo de `EndTurn` (global, `:279-281`), y son medias condicionales (solo partidas donde ocurrió), no probabilidades. Para "P(atacante listo en turno N)" hace falta un handler propio: en `on_action` construir `ViewState::omniscient(state)` (pública, `replay/view.rs:113`) y detectar el primer turno en que el slot tiene al atacante con `energy` suficiente para `attack.energy_required` (Colorless = comodín); acumular un histograma por turno y dividir por partidas. Nota: `hooks::energy_missing` no es accesible (`mod hooks` privado, `lib.rs:13`).
- `DataExporter` (`src/data_exporter.rs`): un JSON pretty por ply con el `State` interno completo (`:11-19, 71-72`); pesado, pensado para ML.
- **Replay** (`src/replay/mod.rs:21-72`, `REPLAY_FORMAT_VERSION = 1`): `{version, game_id, seed, players:[{name, deck:[20 ids]}], cards:{id→Card}, steps:[{ply, turn, actor, state:ViewState, options:[{text, action:SimpleAction}], chosen, note}], final_state, outcome}`; `outcome` serializa `{"Win":0}` o `"Tie"`. `ViewState` (`view.rs:100-108`): `turn, current_player, points, winner, players:[PlayerView], stadium`; `PlayerView` (`:61-72`): `hand (null si redactada), hand_count, deck_count, discard, discard_energies, energy_zone{current,next}, in_play:[4 SlotView|null]`; `SlotView` (`:17-27`): `card, hp, max_hp, energy[], tools[], status[], played_this_turn`. El replay es omnisciente (`recorder.rs:122`). Se escribe compacto (`serde_json::to_string`, `recorder.rs:150`) en `<dir>/<game_id>.json`. Tamaño: `viewer/public/sample-replay.json` = 185 KB para 83 plies (≈1,7-2,2 KB por ply); una partida de 30 turnos puede rondar 300-600 KB (**estimado**). `--replay-sample N` limita vía contador atómico compartido (`:62-64`), **por rival en modo carpeta** (`main.rs:63-67`). Las notas de bot van en `note` (`:129-133`).
- **Optimize** (`src/optimize.rs`): `cli_optimize` (`:103-178`) lee carpeta de rivales (exige 20 cartas), candidatos separados por coma parseados por `robustly_parse_card_id_string` (`:406-426`: acepta `"A1 53"`, `"A1219"`, `"P-A 5"`, `"A2a 072"`; panic si inválido). `missing_count = 20 - len` (`:156, 241`); el "máximo 4" es solo el comentario del CLI (`main.rs:128`), el código no lo limita pero las combinaciones son C(n,k) deduplicadas (`:430-497`). Resultado programático `Vec<(Vec<CardId>, f32)>` ordenado desc (`:401-402`); impresión solo vía `warn!` (`"Combination [..] win percentage: X%"` `:370`, `"Best combination: …"` `:394`). **Empates cuentan como derrota** (`:333-338`). Usa `create_players` ⇒ panic con bots `x` (`players/mod.rs:143-146`).
- **Jugadores** (`src/players/mod.rs:50-66, 68-97`): `aa` (adjunta y ataca), `et` (pasa), `r` (uniforme), `h` (humano por stdin), `w` (ponderado por tipo de acción), `m` (MCTS, **100 iteraciones**, playouts al azar, `:134`, `mcts_player.rs`), `v` (función de valor 1 ply), `e<n>` (expectiminimax; `e` solo = profundidad 3, `:92`; nodos de azar vía `forecast_action` `expectiminimax_player.rs:122`; función de valor `baseline` con pesos puntos 10k, ganar 100k, activo "online" 500, etc. `value_functions.rs:34-50`), `er` (evolution rusher), `x` (bot externo). Sin jugadores ⇒ `r,r`; uno solo ⇒ se completa con `r` (`:103-115`).
- **Python** (`src/python_bindings.rs`, feature `python`, maturin `pyproject.toml:31-34`): `Deck`, `Game(new/play/play_tick/get_state)`, `State` con getters ricos (manos, banca, energía, etc.), `simulate(deck_a, deck_b, players, num_simulations, seed) -> SimulationResults` (**secuencial**, sin rayon, `:857-878`, mismo bug de semilla `:859`), `get_player_types` (sin `x`). Sin event handlers, replays ni optimize.
- **Quién empieza:** moneda con el rng de la partida (`state/mod.rs:291-292`); ambos roban 5 (`:287-290`).
- **Progreso:** `indicatif::ProgressBar` en stderr con plantilla `[{elapsed_precise}] [{bar:40}] {pos}/{len} ({eta})` y tick cada 100 ms (`simulate.rs:517-528`), incrementado por callback (`:424-425`). **[no verificado]** indicatif oculta la barra si stderr no es TTY.
- **Salida final:** `print_stats` (`simulate.rs:531-566`) con `warn!` ⇒ `env_logger` a stderr sin prefijo de nivel (`:577-579`), p. ej. `Player 0 won: 6,150 (61.50%)`, `Draws: 1,200 (12.00%)` (num-format `Locale::en` ⇒ **comas de miles**). **No hay salida legible por máquina** en `simulate`: solo (a) parsear stderr, (b) contar `outcome` en los replays, (c) `--data-output`. `play` imprime a stdout `Player 0 (…) wins!` / `Tie!`, `Points: a (name) - b (name)`, `Replay written to: …` y la URL del viewer (`main.rs:407-428`). Mensajes de bienvenida con `colored` (`main.rs:333`) ⇒ fijar `NO_COLOR=1`.

## 5. Integración del worker: comparación

| | A. CLI + parsear stderr | **B. Crate propio con `deckgym` como git dependency fijada** | C. Bindings Python |
|---|---|---|---|
| Esfuerzo | Bajo al inicio; frágil (regex sobre `warn!`, comas, barra de progreso) | Medio: 1 `main.rs` + 2-3 handlers (~400-800 líneas Rust); requiere mantener Rust | Medio: maturin + Python en la PC; API pobre |
| Semillas reproducibles | No (todas iguales con `--seed`) | Sí (`Game::new(players, seed_i)`) | No (`:859`) |
| Matriz 40×40 | Un proceso por cruce (arranque + `database` lazy por proceso) | Un proceso, rayon sobre cruces | Secuencial |
| "Listo en turno N" | Imposible sin modificar | Handler propio sobre `ViewState` | Posible con `play_tick` + `get_state`, lento |
| Optimize | `cli_optimize` imprime solo warn!; empates = derrota | `optimize()` devuelve `Vec<(Vec<CardId>, f32)>` | No expuesto |
| Replays | `--replay-dir/--replay-sample` OK | `ReplayRecorder::new` es pública (`recorder.rs:39`) | No |
| Play vs bot | Puente externo `x` | Implementar `Player` (trait público, `players/mod.rs:30-46`) | No (`x` no disponible) |
| Validar mazo / cartas no implementadas | `card_status` como proceso + parseo | `get_implementation_status`, `Deck::from_string` + `is_valid` en memoria | `Deck` solo cuenta cartas |
| "Sin modificarlo" (brief 3.5) | Cumple | Cumple: `deckgym = { git = "…", rev = "fb792ebf…" }`; cero cambios al repo | Cumple |
| AGPL | Proceso separado: el worker no es obra derivada (zona gris debatida, pero la más defendible) | Enlace estático ⇒ el binario del worker es obra derivada AGPL; sin distribución no hay obligación; anotar en `LICENCIAS.md` | Enlace dinámico (extensión) ⇒ igual que B |

**Recomendación: B.** Datos a favor verificados: el crate es `rlib` (`Cargo.toml:40`); las cartas están compiladas en `src/database.rs` (95k líneas, generado) ⇒ no necesita `database.json` en runtime; API pública suficiente: `Deck::from_string` (`deck.rs:43`), `Deck::is_valid`, `Game::new/new_with_event_handlers/play/play_tick` (`game.rs:42-122`), `State::generate_possible_actions` (usada en `tui/app.rs:89`), `players::create_players/parse_player_code`, `ViewState::omniscient/for_player`, `ReplayRecorder`, `optimize::optimize`, `card_validation::get_implementation_status`, `CardId::from_card_id`. Diseño: `deckgym-worker-cli job.json → result.json` con jobs `matrix`, `optimize`, `consistency`, `play-step`; cada resultado guarda `rev` del motor, bot, n, semilla base. Reservas: el crate es 0.1.0 sin semver y `State`/`Action` cambian seguido (en el log de este commit ya hay migraciones de mecánicas) ⇒ fijar `rev` y actualizar a mano. Copiar `.cargo/config.toml` del repo a nuestro crate (ver §6).

## 6. Build y ejecución en Windows

- Toolchain: Rust stable (CI `.github/workflows/ci.yml:22`). Objetivo por defecto `x86_64-pc-windows-msvc` requiere **Visual Studio Build Tools con la carga "Desarrollo de escritorio con C++"** (linker `link.exe` + Windows SDK); alternativa `x86_64-pc-windows-gnu` (mingw vía rustup, sin VS). `.cargo/config.toml` del repo fija `/STACK:8388608` (MSVC) o `-Wl,--stack,8388608` (GNU) porque inicializar `database.rs` desborda la pila por defecto de Windows (`.cargo/config.toml:1-16`). **Ese archivo solo aplica al compilar dentro del repo; nuestro crate debe llevar el mismo `.cargo/config.toml`.** Ningún `cfg(windows)` extra salvo el spawn de bots por `cmd /D /S /C` sin ventana (`external_player.rs:64-69`).
- Tiempo/tamaño **[no verificado]**: `database.rs` (95k líneas) + `card_ids.rs` (8,6k) + ~170 crates dominan; esperar varios minutos en `--release` la primera vez y un binario de decenas de MB. Sin `[profile]` en `Cargo.toml`.
- Paralelismo: solo con `-p/--parallel`; `-j N` configura el pool global de rayon (`simulate.rs:204-210`); por defecto rayon usa todos los núcleos lógicos ⇒ CPU al 100 % durante la corrida. Un pool global ya inicializado no se reconfigura (`build_global().ok()`), así que en nuestro crate fijar hilos una sola vez por proceso.
- Sanity check de tiempos del brief: README dice 10k partidas en ~3 s (`README.md:7`; el badge `3340/3761` en `:5` está desactualizado frente a 4271/4317). Brief: 10k `r,r` en 15 s con 2 núcleos ⇒ ~3 ms/partida/núcleo, compatible (máquina más chica, motor con más mecánicas). `e2,e2`: 200 en 7 s ⇒ ~70 ms/partida (35 ms por núcleo); `e3,e3`: 100 en 12,5 s ⇒ 250 ms/partida. Proyección matriz 40×40 (1.600 cruces ordenados; 780 si se simetrizan alternando asiento): `r,r` ×1.000 = 1,6 M partidas ≈ 40 min en 2 núcleos; `e2,e2` ×200 = 320 k ≈ 3 h; `e3,e3` ×100 ≈ 5,5 h. El "ping" de arranque por proceso en la opción A (inicialización lazy de 4.317 cartas) sería adicional.

## 7. "Jugar contra bot" desde la web (Fase 7)

(i) **Protocolo de bot invertido.** Viable sin modificar el motor. El protocolo (`docs/bot-protocol.md`): `hello` → `{"type":"hello","name":…}`; `new_game {you, deck[]}`; por decisión `decide {ply, state: ViewState::for_player, actions:[{i, text, action}]}` → `{"i": n, "note": …}`; sin `game_over` (`:84-89, 104-109`). `ExternalPlayer` (`src/players/external_player.rs`): spawn perezoso en la primera decisión (`:59-84`), lectura por hilo + canal (`:88-103`), `recv_timeout(self.timeout)` (`:171-177`); ante timeout/JSON inválido/índice fuera de rango **elige `actions[0]` y sigue** (`:228-247`, nota `[bot error: …]`). Para un humano el timeout (`--bot-timeout-ms`, default 10 s `simulate.rs:27`) debería ser enorme (p. ej. 1 h) y aun así un timeout juega por él. El motor solo pregunta cuando hay >1 acción (`game.rs:97-107`). **Mejor variante dentro de B:** implementar `Player` en nuestro crate (`decision_fn(&mut self, &mut StdRng, &State, &[Action]) -> Action`), construir `ViewState::for_player(state, actor)` y `actions[i].action.to_string()`, publicar al servidor y hacer long-poll de la elección: sin subproceso, sin timeout artificial, con el replay grabado igual (`on_action_note` para la nota). Lo que la UI puede renderizar: ver §4 (manos propias, contadores, slots con hp/energía/tools/estados, descartes, zona de energía actual/siguiente, estadio, puntos, turno); los ids de carta coinciden con el catálogo M1. Una partida ocupa un hilo del worker mientras dura: aceptable para un usuario. Latencia del bot rival: e2 ≈ 35 ms/decisión, e3 ≈ 125 ms (del brief), ambos aceptables.

(ii) **WebAssembly.** `Cargo.toml:8-29`: `rayon` (usado en `simulate.rs:5`, `optimize.rs:5`), `indicatif` (`simulate.rs:2`), `env_logger` (`simulate.rs:1, 569-580`), `chrono` (declarado, **sin uso en `src/`**), `clap` (solo bins), `uuid` con feature `js` (`:21`, único indicio de wasm). Además `std::process` (`external_player.rs:7`), `std::fs` (`deck.rs:37`, `data_exporter.rs`, `recorder.rs`), `std::time::Instant` (`simulation_event_handler.rs:184-185`, panic en wasm32-unknown-unknown). **No existe ningún `cfg(target_arch = "wasm32")` ni feature-gate en `src/`** (grep vacío) ⇒ compilar a wasm exige feature-gatear `simulate`, `optimize`, `players::external_player`, `players::human_player`, `data_exporter`, `replay::recorder` y `Deck::from_file`, es decir, modificar el motor o mantener un fork: contradice el brief. El núcleo (`Game`, `State`, `apply_action`, `move_generation`, datos) es Rust puro y portable, pero no hay forma de usarlo sin tocar el crate.

(iii) **`h`/TUI.** `HumanPlayer` imprime `debug_string()` y una lista numerada y lee stdin (`human_player.rs:26-47`); el TUI (`--features tui`, `src/bin/tui.rs`) tiene modo interactivo cuando hay un `h` (`tui/app.rs:73-98`) pero es ratatui en terminal. Ninguno sirve desde el navegador/celular.

**Recomendación:** (i) implementado como `Player` propio dentro del crate B (long-poll); el puente `x` stdin/stdout queda como plan B si se eligiera la opción A.

## 8. Reutilización del `viewer/`

- Stack (`viewer/package.json:13-32`): React 19, `pixi.js` 8.21, `@pixi/react` 8, `gsap` 3.15, `pixi-filters` 6, Vite 8, TypeScript 6, vitest. Build `tsc -b && vite build` ⇒ `dist/` estático (`:8`); el middleware `/replays/*` existe solo en `dev`/`preview` (`vite.config.ts:6-13, 60-68`; `viewer/README.md:48-54`).
- Carga: `?url=<json>` por `fetch` (`App.tsx:57-68`, `store/loadReplay.ts:36-42`), drag-drop/selector (`loadReplay.ts:31-34`, `ui/Loader.tsx`), y si no, `sample-replay.json`. Validación mínima: `steps`, `players`, `cards` (`loadReplay.ts:7-18`).
- **No necesita datos de cartas externos:** el replay trae `cards: {id → Card}` (`replay/mod.rs:63-66`; `types/replay.ts:170-179`) y dibuja las cartas proceduralmente (`board/cardArt.ts`). Imágenes opcionales por patrón `?cards=…&lang=…` o `localStorage` o `VITE_CARD_IMAGE_URL` (`board/cardImages.ts:47-56, 82-90`); `main.rs:300-308` arma `&cards=` desde `DECKGYM_CARD_IMAGE_URL`. El brief pide no copiar imágenes: usar enlaces (p. ej. el patrón público de deckgym.com citado en `viewer/README.md:97-99`) o dejar el render procedural.
- Servirlo bajo `/viewer`: sí, con `vite build --base=/viewer/` (flag de CLI; sin tocar `vite.config.ts`) y `?url=/api/replays/<id>.json`. El `fetch` no fija `credentials` ⇒ en mismo origen manda cookies (default `same-origin`), con bearer no; usar cookie de sesión o URL firmada de corta vida.
- Tamaño del bundle **[no verificado]**: no lo construí (habría que `npm install` en el repo, prohibido, o copiarlo); por dependencias esperar ~1,5-2 MB de JS sin comprimir (pixi.js domina).
- AGPL: el viewer es parte del repo AGPL; servirlo desde la app es usar código AGPL en un servicio de red ⇒ si algún día se abre a otras personas, obligación de ofrecer el código (ya contemplado en brief 3.5). Anotarlo en `LICENCIAS.md`.

## 9. Formatos de texto de mazo

- deckgym.com "Share > Copy as Text" (`README.md:15`) corresponde a la forma con cabeceras y números de 3 dígitos; `example_decks/venusaur-exeggutor.txt`:
```
Pokémon: 10
2 Bulbasaur A1 001
2 Exeggcute A1 021
...
Trainer: 10
2 Professor's Research P-A 007
2 Poké Ball P-A 005
...
```
- Forma con `Energy:` (30 de 32 archivos; sin cabeceras, números sin relleno), `example_decks/silvally.txt`:
```
Energy: Lightning
2 Oricorio A3 66
2 Zeraora A3a 21
2 Type: Null A3a 60
2 Silvally A3a 61
2 Gladion A3a 67
2 Elemental Switch A4 151
1 Silver A4 158
1 Giovanni A4b 334
2 Red A4b 352
2 Poké Ball P-A 5
2 Professor's Research P-A 7
```
(`Type: Null` muestra que el nombre puede tener `:`; el parser solo mira los 2 últimos tokens.) Múltiples energías: `Energy: Fire, Lightning` (`deck.rs:326, 214`).
- Las cabeceras `Pokémon: N` / `Trainer: N` de los example_decks tienen la forma habitual de los exports de decklists; que coincidan byte a byte con el export de Limitless (acento en `Pokémon`, sin línea de `Energy`) queda **[no verificado]** aquí. Formato de salida recomendado para la app: `Energy:` explícito + líneas `N Nombre SET NUM` sin cabeceras (lo acepta el parser y evita la ambigüedad del acento).

## Recomendaciones
1. **Integración: opción B.** Crear `worker/engine-cli` (crate Rust propio) con `deckgym = { git = "https://github.com/bcollazo/deckgym-core", rev = "fb792ebfbaca995af9750c28101ce92a51282825" }`, copiar `.cargo/config.toml` (stack 8 MiB), y exponer `engine-cli <job.json> → <result.json>` con jobs: `validate` (parse + `is_valid` + `get_implementation_status` por carta), `matrix`, `optimize`, `consistency` (handler propio "listo en turno N" sobre `ViewState`), `replay-sample`, `play` (humano vs bot). Cada resultado incluye `engine_rev`, bot, n, semilla base y tiempos.
2. **Semillas:** derivar `seed_i = base_seed + i` y crear `Game::new(players, seed_i)` por partida; nunca pasar `--seed` al CLI original (produce N partidas idénticas). Guardar `base_seed` para reproducir cualquier partida.
3. **Exportación a deckgym:** emitir SIEMPRE `Energy: …` (nombres en inglés), sin cabeceras, líneas `N Nombre SET NUM`; validar en la app 20 cartas / ≤2 por nombre / ≥1 básico / energías seleccionables antes de encolar, porque `simulate` no valida. Mazo 9 → `Energy: Fire, Lightning`; mazo 10 → un tipo seleccionable fijo.
4. **Cartas no implementadas:** carta funcional = (nombre, texto); al exportar elegir una edición con `get_implementation_status == Complete` del mismo grupo (preferir menor rareza); si ninguna edición del grupo está implementada, marcar el mazo "no simulable" con la carta. Recalcular la lista al actualizar el `rev` del motor (no cachear los 46 a mano).
5. **Rareza:** normalizar la notación (`*`→`✵`, `♛`→`Crown Rare`, promos) o tomar la rareza del tracker; usar el id como clave de cruce. Revisar HP de `P-A 022` (50 vs 60).
6. **Play vs bot:** implementar `Player` en el crate propio con long-poll al servidor; usar `e2` como rival por defecto (latencia ≈ 35 ms/decisión); grabar el replay con `ReplayRecorder`.
7. **Viewer:** reutilizarlo como bundle estático (`vite build --base=/viewer/`), alimentado por `?url=` a un endpoint autenticado por cookie; mantener render procedural o patrón de imágenes por enlace. Documentar AGPL en `LICENCIAS.md`.
8. **Windows:** instalar Rust stable + VS Build Tools (C++) o toolchain GNU; compilar en `--release`; en el worker fijar `-j` configurable y arrancar un solo pool rayon por proceso; `NO_COLOR=1` si se invoca el CLI original.
9. **Estadísticas:** mostrar victorias/derrotas/empates por separado (los empates son mayormente límite de 30 turnos) y, para `optimize`, no usar el % del motor (empates = derrota) sino el handler propio.

## Riesgos
- **Semilla compartida (simulate.rs:247, optimize.rs:324/347, python_bindings.rs:859):** con `--seed` todas las partidas son idénticas; un worker basado en el CLI reportaría 100 %/0 % espurios. Mitigación: opción B con semilla por partida.
- **Sin validación en `simulate`:** mazos de ≠20 cartas, >2 copias o energía inferida errónea se simulan en silencio; energía inferida con Dragon/Colorless hace panic (game.rs:178) y un Incoloro de relleno contamina la Zona de Energía (state/mod.rs:1072). Mitigación: validar en la app y emitir `Energy:` siempre.
- **API inestable:** crate 0.1.0, sin semver, `State`/`SimpleAction`/mapas de mecánicas cambian por commit; `REPLAY_FORMAT_VERSION = 1`. Mitigación: fijar `rev`, tests de humo del crate propio al actualizar, guardar `engine_rev` en cada resultado.
- **Build en Windows:** VS Build Tools (varios GB) o mingw; `database.rs` de 95k líneas requiere el flag de stack y compila lento. Mitigación: copiar `.cargo/config.toml`, compilar una vez en release, cachear el binario.
- **Costo de la matriz 40×40:** `e2,e2` ×200 ≈ 3 h, `e3,e3` ×100 ≈ 5,5 h en 2 núcleos (estimado desde los tiempos del brief). Mitigación: simetrizar cruces, reanudación por cruce, `r`/`w` para barridos gruesos y `e2` para los finos.
- **Resultados dependen del bot** (61,5 % vs 51 % entre e2 y e3 según el brief) y los empates reflejan el límite de 30 turnos. Mitigación: la UI muestra siempre bot, n e intervalo, y separa empates.
- **Reimpresiones futuras (A4b/B4b-style):** cada set con reimpresiones de Entrenadores volverá a aparecer como "no implementado" hasta que el autor agregue las variantes al `match`. Mitigación: mapeo por texto automático en la exportación.
- **AGPL:** el worker (B) es obra derivada enlazada estáticamente y el viewer es código AGPL servido en red; sin distribución/apertura no hay obligaciones, pero hay que dejarlo escrito. Mitigación: `LICENCIAS.md` con el detalle y el `rev`.
- **Play vs bot ocupa un hilo del worker por partida** y, si se usara `ExternalPlayer`, un timeout juega por el humano. Mitigación: `Player` propio sin timeout y un slot dedicado para partidas interactivas.
- **Bundle del viewer no medido** y tracker/viewer requieren `npm` en build. Mitigación: construir en CI de la app, no en runtime.

## Preguntas abiertas
1. Mazo 10 (todo Incoloro): ¿qué energía declaraste en el juego? Para simular sirve cualquiera seleccionable; conviene usar la misma que en el juego.
2. ¿Aceptás instalar Visual Studio Build Tools (carga C++) en la PC o preferís el toolchain GNU (mingw) para compilar el worker?
3. ¿Cuántos núcleos querés reservar por defecto para el worker (tu PC tiene 2 según el brief)? Afecta el tamaño realista de la matriz y el bot por defecto (`r`, `w`, `e2`, `e3`).
4. ¿Querés el viewer de deckgym embebido en la app (código AGPL servido desde tu dominio) o un visor propio simple en texto, acorde a "texto primero"?
5. Para "jugar contra bot": ¿aceptás que la partida corra en el worker de la PC (requiere PC encendida) con `e2` como rival por defecto?
6. ¿Cuál es el HP correcto de `P-A 22` (deckgym 50, tracker 60)? Sirve para decidir qué fuente manda en M1 cuando difieren.
7. ¿Confirmás que el formato de intercambio entre app y motor sea el deckgym sin cabeceras y con `Energy:` explícito, y que el formato Limitless lo valide el investigador de Limitless?

## Fuentes
Rutas bajo `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core` salvo indicación.

- `README.md:5,7,15,139-154,210-225`
- `Cargo.toml:8-40`; `Cargo.lock` (rayon 1.11, indicatif 0.18.2, env_logger 0.11.8, uuid 1.18.1, pyo3 0.22.6, clap 4.5.48); `.cargo/config.toml:1-16`; `pyproject.toml:31-34`; `.github/workflows/ci.yml:22`
- `src/deck.rs:14-17,31,36-41,43-96,98-125,138-156,161-181,184-186,200-220`
- `src/card_validation.rs:12-36,39-76`; `src/bin/card_status.rs:28-41,44-53,56-95,97-133,135-163`
- `src/actions/effect_mechanic_map.rs:17-21`; `src/actions/effect_ability_mechanic_map.rs:12-16,789-806`; `src/tools.rs:27-84,139-171`; `src/stadiums.rs:33-78`; `src/move_generation/move_generation_trainer.rs:33-56,60-319,463-497,1066-1081`; `src/card_ids.rs:8-10,4329-4331,6245,8428,8651-8655`; `src/bin/card_enum_generator.rs:49-57`
- `src/models/card.rs:13-24,28-37,39-53,61-63,83-114,128-134,138-145,158-162,200-227,274-286`
- `src/state/mod.rs:67,279-301,739-749,751-753,1072-1077`; `src/actions/apply_action_helpers.rs:883-930`; `src/state/observation.rs:1-40,114-120`
- `src/game.rs:16-26,29-56,58-68,75-83,91-122,164-185`
- `src/simulate.rs:27,30-64,66-85,88-165,167-201,203-308,311-319,339-370,373-435,441-460,471-514,517-528,531-566,569-580`
- `src/simulation_event_handler.rs:15-19,21-55,58-142,145-158,161-174,199-260,264-303`; `src/gameplay_stats_collector.rs:12-23,25-60,94-190,193-254,257-301`; `examples/gameplay_stats.rs:17-61`
- `src/data_exporter.rs:11-19,38-106`; `src/replay/mod.rs:21-72`; `src/replay/recorder.rs:28-52,54-171`; `src/replay/view.rs:17-27,61-72,100-108,110-137`
- `src/optimize.rs:17-57,103-178,181-214,217-403,406-426,430-517`
- `src/players/mod.rs:30-46,50-66,68-97,103-115,117-148,154-182`; `src/players/external_player.rs:21-45,59-142,146-189,201-254,265-275`; `src/players/human_player.rs:14-53`; `src/players/mcts_player.rs:12-67`; `src/players/expectiminimax_player.rs:30-109,111-122`; `src/players/value_functions.rs:14-79`; `src/players/random_player.rs:12-18`; `src/players/weighted_random_player.rs:14-27`; `src/players/evolution_rusher_player.rs:13-26`
- `src/python_bindings.rs:387-411,719-786,788-889,891-904`; `src/lib.rs:1-55`; `python/deckgym/README.md`
- `src/main.rs:19-163,165-278,280-308,310-470`; `src/bin/tui.rs:21-37`; `src/tui/app.rs:62-104`
- `docs/bot-protocol.md:1-134`; `examples/bots/random_bot.py`; `tests/external_bot_test.rs:13-34`
- `viewer/README.md:1-10,25-33,48-54,66-99,101-107`; `viewer/package.json:6-32`; `viewer/vite.config.ts:6-13,14-74`; `viewer/src/App.tsx:23-68`; `viewer/src/store/loadReplay.ts:7-42`; `viewer/src/board/cardImages.ts:1-10,47-56,82-90`; `viewer/src/types/replay.ts:11-61,101,150-179`; `viewer/public/sample-replay.json` (185 KB, 83 steps)
- `example_decks/silvally.txt`, `venusaur-exeggutor.txt`, `weezing-arbok.txt`, `incomplete-chari.txt`, `altaria.txt`
- `database.json` (4.317 cartas); `..\tracker\frontend\assets\cards.json` (4.317); `C:\Users\<usuario>\Downloads\tcgcollectiontracterexport (2).csv` (4.317 filas, solo lectura)
- `C:\Users\<usuario>\Personal\tcg pocket\Docs\BRIEF.md:83-102,120-127,189-198`; `Docs\context\mazos_40_listas.md:23-24,100-108`
- Scripts del análisis (scratchpad): `C:\Users\<usuario>\AppData\Local\Temp\claude\C--Users-<usuario>-Personal-tcg-pocket\744b015a-5491-4593-b20b-d31f39f97693\scratchpad\ids_compare.js`, `card_status.js`, `incomplete.json`

//! The golden games of `GAMES_REV` (phase 42): a fixed set of games, consistency runs, an optimize, games against the
//! bot with fixed choices and one decision of the coach, with what this engine gives them, kept in `games-rev.json`.
//! Each game keeps a hash of its moves (who did what, in order), not only who won: a bot that plays another move and
//! still wins is another way of playing. If the code changes how something that already existed plays (rules, bots,
//! seeds, decks), these results change: the test fails until `GAMES_REV` goes up and the file is made again, so that
//! the queue never mixes in one job the games of two ways of playing.
//!
//! Make the file again (after raising `GAMES_REV`, when deckgym changes, or to add cases):
//! `cargo test --release regenerate_games_rev -- --ignored`. With the same `GAMES_REV` and deckgym it refuses to change
//! the result of a case that was already there.

use super::*;
use crate::fair_bot::{create_players, fair_value_function, parse_bot_code};
use crate::g_bot::tests::{DEDENNE, MISMAGIUS};
use crate::g_bot::{g_value_function, GParams};
use crate::play::{run_live_game, Ask};
use deckgym::actions::Action;
use deckgym::simulation_event_handler::{CompositeSimulationEventHandler, SimulationEventHandler};
use deckgym::state::GameOutcome;
use deckgym::{Game, State};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

const FILE: &str = "games-rev.json";

const ALTARIA: &str = crate::coach::tests::ALTARIA;
/// What g models that Altaria and Venusaur never show (review of #142): Poison and Burn, attacks that count on them, and
/// Tools on both sides. Built for the golden games, with no list behind it.
const POISON_BURN: &str = "Energy: Fire, Darkness\n2 Blacephalon ex B2 23\n2 Heatmor A4 37\n2 Seviper B3 104\n2 Nihilego A3a 42\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n2 Rocky Helmet A2 148\n2 Giant Cape A2 147\n1 Cyrus A2 150\n1 Pokémon Center Lady A2b 70\n";
/// C1 «Dual Fusion» (29/10/2026, D-031): Mega Mewtwo X ex is [P] and [F], weak to [D]; Mega Greninja ex is [W] and [D],
/// so its hits on Mewtwo meet that Weakness through its second type. Built for the golden games, with no list behind it.
const MEWTWO_C1: &str = "Energy: Psychic, Fighting\n2 Mega Mewtwo X ex C1 56\n2 Riolu A2 91\n2 Mega Lucario ex B3 81\n1 Lucario A2 92\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n1 Sabrina A1 225\n1 Cyrus A2 150\n2 Giant Cape A2 147\n1 Training Area B2 153\n2 X Speed P-A 2\n";
const GRENINJA_C1: &str = "Energy: Water, Darkness\n2 Froakie C1 40\n2 Frogadier C1 41\n2 Mega Greninja ex C1 42\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n2 Rare Candy A3 144\n1 Cyrus A2 150\n2 Giant Cape A2 147\n1 Sabrina A1 225\n2 Lucky Ice Pop B2 145\n";
const VENUSAUR: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64\n";

/// Every bot, each against the random one, from both sides; the slow ones with fewer games.
fn cases() -> Vec<Value> {
    let mut cases = Vec::new();
    for (bot, games) in [
        ("r", 4),
        ("w", 4),
        ("aa", 4),
        ("v", 4),
        ("er", 4),
        ("m", 2),
        ("e1", 4),
        ("e2", 2),
        ("e3", 1),
        ("f1", 4),
        ("f2", 2),
        // engine-cli 0.3.5 (H-051): the bot that only ends its turn.
        ("et", 4),
        // engine-cli 0.3.16 (T-021): the g bots, as the app takes them (docs/BOTS.md).
        ("g1", 4),
        ("g2", 2),
    ] {
        cases.push(json!({
            "command": "simulate",
            "job": { "deckA": ALTARIA, "deckB": VENUSAUR, "players": [bot, "r"], "games": games, "seed": 4201, "threads": 1, "perGame": true },
        }));
        cases.push(json!({
            "command": "simulate",
            "job": { "deckA": VENUSAUR, "deckB": ALTARIA, "players": ["r", bot], "games": games, "seed": 4202, "threads": 1, "perGame": true },
        }));
    }
    // g on what it models apart from f (review of #142): Dedenne's Tools and pending damage, Mismagius and Latias, and a
    // side that poisons and burns. Without them a change in how g weighs those played the Altaria games the same.
    for (deck_a, deck_b, players, seed) in [
        (DEDENNE, POISON_BURN, ["g2", "e2"], 4214),
        (POISON_BURN, MISMAGIUS, ["g2", "r"], 4215),
        (MISMAGIUS, DEDENNE, ["g1", "g2"], 4216),
    ] {
        cases.push(json!({
            "command": "simulate",
            "job": { "deckA": deck_a, "deckB": deck_b, "players": players, "games": 2, "seed": seed, "threads": 1, "perGame": true },
        }));
    }
    cases.push(json!({
        "command": "simulate",
        "job": { "deckA": ALTARIA, "deckB": VENUSAUR, "players": ["e2", "f2"], "games": 2, "seed": 4203, "threads": 1, "perGame": true },
    }));
    // Two printed types (C1, D-031): the search bots, f's clock and g's evaluation on Pokémon of two types, so that a
    // change in how deckgym or the bots read a second type shows here (review of the C1 engine change).
    for (deck_a, deck_b, players, seed) in [
        (MEWTWO_C1, GRENINJA_C1, ["e2", "g2"], 4220),
        (GRENINJA_C1, MEWTWO_C1, ["f2", "g2"], 4221),
    ] {
        cases.push(json!({
            "command": "simulate",
            "job": { "deckA": deck_a, "deckB": deck_b, "players": players, "games": 2, "seed": seed, "threads": 1, "perGame": true },
        }));
    }
    cases.push(json!({
        "command": "consistency",
        "job": { "deck": ALTARIA, "keyCards": ["B1 102"], "games": 8, "seed": 4204, "threads": 1, "bot": "e1", "maxTurn": 6 },
    }));
    cases.push(json!({
        "command": "consistency",
        "job": { "deck": ALTARIA, "keyCards": ["B1 102"], "games": 4, "seed": 4205, "threads": 1, "bot": "e1", "maxTurn": 6, "rivals": [{ "deck": VENUSAUR, "games": 4 }] },
    }));
    let without_jirachi: String = ALTARIA.lines().filter(|line| !line.contains("Jirachi")).collect::<Vec<_>>().join("\n");
    cases.push(json!({
        "command": "optimize",
        "job": { "deck": without_jirachi, "candidates": ["B1 106", "A1 225"], "missing": 1, "enemies": [VENUSAUR], "gamesPerEnemy": 2, "players": ["r", "r"], "seed": 4206, "threads": 1 },
    }));
    // A game against the bot (`engine-cli play`) as a worker replays it: the same seed and the owner's choices.
    for (bot, seed) in [("e2", 4207), ("f2", 4208), ("r", 4209), ("g2", 4213)] {
        cases.push(json!({
            "command": "play",
            "job": { "deckHuman": ALTARIA, "deckBot": VENUSAUR, "bot": bot, "seed": seed, "choices": [0, 2, 1, 3, 1, 0, 2] },
        }));
    }
    // The coach's values for the owner's first decision with a choice, as `engine-cli play` shows them.
    // How the f bots value a table, at every moment of a fixed game (the random bots on both sides): a change in how
    // they weigh things shows here even when these games happen to keep their moves (review of #68: a clock cap that
    // only matters past 20 turns).
    for (seed, deck_a, deck_b) in [(4211, VENUSAUR, ALTARIA), (4212, ALTARIA, VENUSAUR), (4222, GRENINJA_C1, MEWTWO_C1)] {
        cases.push(json!({
            "command": "values",
            "job": { "deckA": deck_a, "deckB": deck_b, "seed": seed },
        }));
    }
    // The same for g's evaluation, with its default weights, on boards with Poison, Burn and Tools: every constant of
    // g_bot.rs shows here even when the games above keep their moves (review of #142). Each trace also counts how many
    // of its moments have a Poisoned or Burned Active and a Tool in play, so that a deckgym or deck change that leaves
    // them out fails `the_g_traces_see_poison_burn_and_tools` instead of passing unseen.
    for (seed, deck_a, deck_b) in [
        (4217, POISON_BURN, DEDENNE),
        (4218, MISMAGIUS, POISON_BURN),
        (4219, DEDENNE, MISMAGIUS),
        (4223, MEWTWO_C1, GRENINJA_C1),
    ] {
        cases.push(json!({
            "command": "gValues",
            "job": { "deckA": deck_a, "deckB": deck_b, "seed": seed },
        }));
    }
    cases.push(json!({
        "command": "coach",
        "job": { "deckHuman": ALTARIA, "deckBot": VENUSAUR, "bot": "e2", "seed": 4210, "coach": true },
    }));
    cases
}

/// FNV-1a (64 bits), as build.rs does for the build fingerprint.
fn fnv(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The moves of a replay file: who chose what, in order.
fn replay_moves(file: &str) -> String {
    let replay: Value = serde_json::from_str(&std::fs::read_to_string(file).expect("replay")).expect("replay json");
    let lines: Vec<String> = replay["steps"]
        .as_array()
        .expect("steps")
        .iter()
        .map(|step| {
            let chosen = step["chosen"].as_u64().expect("chosen") as usize;
            format!("{}:{}", step["actor"], step["options"][chosen]["text"].as_str().expect("text"))
        })
        .collect();
    fnv(&lines.join("\n"))
}

static DIRS: AtomicUsize = AtomicUsize::new(0);

fn scratch_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "engine-games-rev-{}-{}",
        std::process::id(),
        DIRS.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

/// Every action of the game, in order (who and what).
struct Moves(Arc<Mutex<Vec<String>>>);

impl SimulationEventHandler for Moves {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, _state: &State, actor: usize, _playable: &[Action], action: &Action) {
        self.0.lock().expect("moves").push(format!("{actor}:{}", action.action));
    }
}

/// Both sides' value of the table by a bot's function, at every action of the game.
struct Values(Arc<Mutex<Vec<String>>>, fn(&State, usize) -> f64);

impl SimulationEventHandler for Values {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, state: &State, _actor: usize, _playable: &[Action], _action: &Action) {
        let values = [(self.1)(state, 0), (self.1)(state, 1)];
        self.0.lock().expect("values").push(format!("{:.3},{:.3}", values[0], values[1]));
    }
}

/// How many moments of the game have a Poisoned Active, a Burned Active and a Tool in play.
struct Seen(Arc<Mutex<[usize; 3]>>);

impl SimulationEventHandler for Seen {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, state: &State, _actor: usize, _playable: &[Action], _action: &Action) {
        let actives: Vec<_> = state.in_play_pokemon.iter().filter_map(|side| side[0].as_ref()).collect();
        let tools = state.in_play_pokemon.iter().flatten().flatten().any(|pokemon| pokemon.has_tool_attached());
        let mut seen = self.0.lock().expect("seen");
        seen[0] += usize::from(actives.iter().any(|active| active.is_poisoned()));
        seen[1] += usize::from(actives.iter().any(|active| active.is_burned()));
        seen[2] += usize::from(tools);
    }
}

fn g_value(state: &State, myself: usize) -> f64 {
    g_value_function(state, myself, &GParams::default())
}

/// A game of the random bots, and how a bot's function (the f bots' or g's) values it as it goes.
fn value_trace(job: &Value, value: fn(&State, usize) -> f64) -> Value {
    let deck_a = require_simulable("A", job["deckA"].as_str().expect("deckA")).expect("deck");
    let deck_b = require_simulable("B", job["deckB"].as_str().expect("deckB")).expect("deck");
    let seed = job["seed"].as_u64().expect("seed");
    let random = parse_bot_code("r").expect("r");
    let players = create_players(deck_a, deck_b, vec![random.clone(), random]);
    let values = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::new(Mutex::new([0; 3]));
    let mut handler = CompositeSimulationEventHandler::new(vec![
        Box::new(Values(values.clone(), value)),
        Box::new(Seen(seen.clone())),
    ]);
    {
        let mut game = Game::new_with_event_handlers(Uuid::from_u64_pair(seed, 1), players, seed, &mut handler);
        game.play();
    }
    let values = values.lock().expect("values");
    let [poisoned, burned, tools] = *seen.lock().expect("seen");
    json!({ "moments": values.len(), "values": fnv(&values.join("\n")), "poisoned": poisoned, "burned": burned, "tools": tools })
}

/// A game against the bot through play.rs (`run_live_game`, the seat and numbering `engine-cli play` uses), with the
/// owner's answers from a fixed list: `choices[k]` modulo the options of the k-th decision with more than one.
fn scripted_game(job: &Value, coach: bool) -> Value {
    let deck_human = require_simulable("tuyo", job["deckHuman"].as_str().expect("deckHuman")).expect("deck");
    let deck_bot = require_simulable("del bot", job["deckBot"].as_str().expect("deckBot")).expect("deck");
    let bot = job["bot"].as_str().expect("bot");
    let code = parse_bot_code(bot).expect("bot code");
    let seed = job["seed"].as_u64().expect("seed");
    let choices: Vec<usize> = job["choices"]
        .as_array()
        .map(|list| list.iter().map(|c| c.as_u64().expect("choice") as usize).collect())
        .unwrap_or_default();
    // The coach's values as the owner's first decision showed them.
    let first_coach = Arc::new(Mutex::new(None::<Value>));
    let probe = first_coach.clone();
    let mut next = 0usize;
    let ask: Ask = Box::new(move |decide: &Value, options: usize| {
        let mut first = probe.lock().expect("coach");
        if first.is_none() && !decide["coach"].is_null() {
            *first = Some(decide["coach"].clone());
        }
        let pick = choices.get(next % choices.len().max(1)).copied().unwrap_or(0);
        next += 1;
        // The answer is the option's label (`i`), as the app sends it back: a change in how play.rs labels them shows.
        decide["actions"][pick % options]["i"].as_u64().expect("label") as usize
    });
    let moves = Arc::new(Mutex::new(Vec::new()));
    let (outcome, state) =
        run_live_game(&deck_human, &deck_bot, code, bot, seed, coach, ask, vec![Box::new(Moves(moves.clone()))]);
    if coach {
        return first_coach.lock().expect("coach").clone().expect("a decision with a choice");
    }
    let winner = match outcome {
        Some(GameOutcome::Win(0)) => "you",
        Some(GameOutcome::Win(_)) => "bot",
        Some(GameOutcome::Tie) | None => "tie",
    };
    let moves = moves.lock().expect("moves").join("\n");
    json!({ "winner": winner, "turns": state.turn_count, "moves": fnv(&moves) })
}

/// What a case gives, without what depends on the machine or on the build (time, fingerprint, version, deckgym rev).
fn run(case: &Value) -> Value {
    let mut job = case["job"].clone();
    let result = match case["command"].as_str() {
        Some("simulate") => {
            // Every game recorded, for the hash of its moves.
            let dir = scratch_dir();
            job["replaySample"] = job["games"].clone();
            job["replayDir"] = json!(dir.display().to_string());
            let mut result =
                serde_json::to_value(simulate(serde_json::from_value(job).expect("job")).expect("simulate")).expect("json");
            let mut replays = result["replays"].as_array().cloned().unwrap_or_default();
            replays.sort_by_key(|replay| replay["index"].as_u64());
            result["moves"] = json!(replays
                .iter()
                .map(|replay| replay_moves(replay["file"].as_str().expect("file")))
                .collect::<Vec<_>>());
            let _ = std::fs::remove_dir_all(&dir);
            result
        }
        Some("consistency") => serde_json::to_value(
            consistency::consistency(serde_json::from_value(job).expect("job")).expect("consistency"),
        )
        .expect("json"),
        Some("optimize") => {
            serde_json::to_value(optimize(serde_json::from_value(job).expect("job")).expect("optimize")).expect("json")
        }
        Some("play") => scripted_game(&job, false),
        Some("coach") => scripted_game(&job, true),
        Some("values") => {
            // The f traces were recorded before these counts: their cases stay as they were.
            let mut trace = value_trace(&job, fair_value_function);
            for key in ["poisoned", "burned", "tools"] {
                trace.as_object_mut().expect("trace").remove(key);
            }
            trace
        }
        Some("gValues") => value_trace(&job, g_value),
        other => panic!("unknown command {other:?}"),
    };
    let mut stable = result;
    if let Value::Object(map) = &mut stable {
        for key in ["durationMs", "build", "cliVersion", "engineRev", "replays"] {
            map.remove(key);
        }
    }
    stable
}

fn file() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FILE)
}

/// How a failing case is named: its command, its bots and its seed.
fn label(case: &Value) -> String {
    let job = &case["job"];
    let bots = if job["players"].is_null() { job["bot"].clone() } else { job["players"].clone() };
    format!("{} {} seed {}", case["command"], bots, job["seed"])
}

fn key(case: &Value) -> String {
    format!("{}|{}", case["command"], case["job"])
}

#[test]
#[ignore = "writes games-rev.json: run it after raising GAMES_REV, when deckgym changes, or to add cases"]
fn regenerate_games_rev() {
    let cases: Vec<Value> = cases()
        .into_iter()
        .map(|case| {
            let expected = run(&case);
            json!({ "command": case["command"], "job": case["job"], "expected": expected })
        })
        .collect();
    // Same GAMES_REV and same deckgym: a case already there must give what it gave (review of #68). Adding or taking
    // out cases is fine; playing otherwise means raising GAMES_REV first.
    if let Ok(text) = std::fs::read_to_string(file()) {
        let old: Value = serde_json::from_str(&text).expect("json");
        if old["gamesRev"] == GAMES_REV && old["engineRev"] == ENGINE_REV {
            let before: std::collections::HashMap<String, Value> = old["cases"]
                .as_array()
                .expect("cases")
                .iter()
                .map(|case| (key(case), case["expected"].clone()))
                .collect();
            for case in &cases {
                if let Some(expected) = before.get(&key(case)) {
                    if !expected_matches(&case["expected"], expected) {
                        panic!(
                            "{} plays otherwise with the same GAMES_REV: raise GAMES_REV in seeds.rs first",
                            label(case),
                        );
                    }
                }
            }
        }
    }
    let document = json!({ "gamesRev": GAMES_REV, "engineRev": ENGINE_REV, "cases": cases });
    std::fs::write(file(), serde_json::to_string_pretty(&document).expect("json") + "\n").expect("write");
}

/// A case kept from before this file had move hashes still matches on everything it had.
fn expected_matches(now: &Value, before: &Value) -> bool {
    match (now, before) {
        (Value::Object(now), Value::Object(before)) => {
            before.iter().all(|(field, value)| now.get(field).is_some_and(|mine| expected_matches(mine, value)))
        }
        _ => now == before,
    }
}

#[test]
fn the_golden_games_play_the_same_for_this_games_rev() {
    let text = std::fs::read_to_string(file()).expect("games-rev.json (cargo test --release regenerate_games_rev -- --ignored)");
    let document: Value = serde_json::from_str(&text).expect("json");
    if document["engineRev"] != ENGINE_REV {
        // Another deckgym is another key anyway (engineRev): the file is just made again.
        panic!("games-rev.json is from another deckgym: make it again with `cargo test --release regenerate_games_rev -- --ignored`");
    }
    assert_eq!(
        document["gamesRev"], GAMES_REV,
        "GAMES_REV changed: make games-rev.json again with `cargo test --release regenerate_games_rev -- --ignored`"
    );
    let cases = document["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), self::cases().len(), "the set of cases changed: make games-rev.json again");
    for (at, case) in cases.iter().enumerate() {
        assert_eq!(
            run(case),
            case["expected"],
            "case {at} ({}) plays otherwise: if that is on purpose, raise GAMES_REV in main.rs and make games-rev.json again",
            label(case),
        );
    }
}

#[test]
fn the_g_traces_see_poison_burn_and_tools() {
    // What the gValues cases are there for (review of #142): if a deck or deckgym change left them without a Poisoned or
    // Burned Active or a Tool in play, a change in how g weighs those would pass the golden games unseen.
    let traces: Vec<Value> = cases().iter().filter(|case| case["command"] == "gValues").map(run).collect();
    for key in ["poisoned", "burned", "tools"] {
        let moments: u64 = traces.iter().map(|trace| trace[key].as_u64().expect(key)).sum();
        assert!(moments > 0, "no gValues trace has a moment with {key}: {traces:?}");
    }
}

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
use crate::coach::coach_scores;
use crate::fair_bot::{create_players, fair_value_function, parse_bot_code};
use deckgym::actions::Action;
use deckgym::players::Player;
use deckgym::simulation_event_handler::{CompositeSimulationEventHandler, SimulationEventHandler};
use deckgym::state::GameOutcome;
use deckgym::{Deck, Game, State};
use rand::rngs::StdRng;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

const FILE: &str = "games-rev.json";

const ALTARIA: &str = crate::coach::tests::ALTARIA;
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
    cases.push(json!({
        "command": "simulate",
        "job": { "deckA": ALTARIA, "deckB": VENUSAUR, "players": ["e2", "f2"], "games": 2, "seed": 4203, "threads": 1, "perGame": true },
    }));
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
    for (bot, seed) in [("e2", 4207), ("f2", 4208), ("r", 4209)] {
        cases.push(json!({
            "command": "play",
            "job": { "deckHuman": ALTARIA, "deckBot": VENUSAUR, "bot": bot, "seed": seed, "choices": [0, 2, 1, 3, 1, 0, 2] },
        }));
    }
    // The coach's values for the owner's first decision with a choice (few samples: it plays each option to the end of
    // the turn).
    // How the f bots value a table, at every moment of a fixed game (the random bots on both sides): a change in how
    // they weigh things shows here even when these games happen to keep their moves (review of #68: a clock cap that
    // only matters past 20 turns).
    for (seed, deck_a, deck_b) in [(4211, VENUSAUR, ALTARIA), (4212, ALTARIA, VENUSAUR)] {
        cases.push(json!({
            "command": "values",
            "job": { "deckA": deck_a, "deckB": deck_b, "seed": seed },
        }));
    }
    cases.push(json!({
        "command": "coach",
        "job": { "deckHuman": ALTARIA, "deckBot": VENUSAUR, "bot": "e2", "seed": 4210, "samples": 3 },
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

/// For a coach case: its seed and samples, both decks, and where the first decision's values go.
type CoachProbe = (u64, u64, [Deck; 2], Arc<Mutex<Option<Vec<f64>>>>);

/// The owner's seat of a game against the bot, choosing by a fixed list (`choices[k]` modulo the options, for the
/// k-th decision with more than one), as a worker replays the owner's choices.
struct ScriptedOwner {
    deck: Deck,
    choices: Vec<usize>,
    next: usize,
    coach: Option<CoachProbe>,
}

impl std::fmt::Debug for ScriptedOwner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Santi")
    }
}

impl Player for ScriptedOwner {
    fn get_deck(&self) -> Deck {
        self.deck.clone()
    }

    fn decision_fn(&mut self, _rng: &mut StdRng, state: &State, possible_actions: &[Action]) -> Action {
        if possible_actions.len() == 1 {
            return possible_actions[0].clone();
        }
        if let Some((seed, samples, decks, scores)) = &self.coach {
            let mut first = scores.lock().expect("scores");
            if first.is_none() {
                *first = Some(coach_scores(state, possible_actions, decks, game_seed(*seed, 1), *samples));
            }
        }
        let pick = self.choices.get(self.next % self.choices.len().max(1)).copied().unwrap_or(0);
        self.next += 1;
        possible_actions[pick % possible_actions.len()].clone()
    }
}

/// Every action of the game, in order (who and what).
struct Moves(Arc<Mutex<Vec<String>>>);

impl SimulationEventHandler for Moves {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, _state: &State, actor: usize, _playable: &[Action], action: &Action) {
        self.0.lock().expect("moves").push(format!("{actor}:{}", action.action));
    }
}

/// Both sides' value of the table by the f bots' function, at every action of the game.
struct Values(Arc<Mutex<Vec<String>>>);

impl SimulationEventHandler for Values {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, state: &State, _actor: usize, _playable: &[Action], _action: &Action) {
        let values = [fair_value_function(state, 0), fair_value_function(state, 1)];
        self.0.lock().expect("values").push(format!("{:.3},{:.3}", values[0], values[1]));
    }
}

/// A game of the random bots, and how the f bots value it as it goes.
fn value_trace(job: &Value) -> Value {
    let deck_a = require_simulable("A", job["deckA"].as_str().expect("deckA")).expect("deck");
    let deck_b = require_simulable("B", job["deckB"].as_str().expect("deckB")).expect("deck");
    let seed = job["seed"].as_u64().expect("seed");
    let random = parse_bot_code("r").expect("r");
    let players = create_players(deck_a, deck_b, vec![random.clone(), random]);
    let values = Arc::new(Mutex::new(Vec::new()));
    let mut handler = CompositeSimulationEventHandler::new(vec![Box::new(Values(values.clone()))]);
    {
        let mut game = Game::new_with_event_handlers(Uuid::from_u64_pair(seed, 1), players, seed, &mut handler);
        game.play();
    }
    let values = values.lock().expect("values");
    json!({ "moments": values.len(), "values": fnv(&values.join("\n")) })
}

/// A game against the bot as `engine-cli play` builds it (play.rs), with the owner's seat scripted.
fn scripted_game(job: &Value, coach: bool) -> Value {
    let deck_human = require_simulable("tuyo", job["deckHuman"].as_str().expect("deckHuman")).expect("deck");
    let deck_bot = require_simulable("del bot", job["deckBot"].as_str().expect("deckBot")).expect("deck");
    let code = parse_bot_code(job["bot"].as_str().expect("bot")).expect("bot code");
    let seed = job["seed"].as_u64().expect("seed");
    let choices: Vec<usize> = job["choices"]
        .as_array()
        .map(|list| list.iter().map(|c| c.as_u64().expect("choice") as usize).collect())
        .unwrap_or_default();
    let scores = Arc::new(Mutex::new(None));
    let owner = ScriptedOwner {
        deck: deck_human.clone(),
        choices,
        next: 0,
        coach: coach.then(|| {
            (
                seed ^ 0xC0AC_4000_0000_0000,
                job["samples"].as_u64().expect("samples"),
                [deck_human.clone(), deck_bot.clone()],
                scores.clone(),
            )
        }),
    };
    let bot = create_players(deck_human.clone(), deck_bot.clone(), vec![code.clone(), code])
        .pop()
        .expect("two players");
    let players: Vec<Box<dyn Player>> = vec![Box::new(owner), bot];
    let moves = Arc::new(Mutex::new(Vec::new()));
    let mut handler = CompositeSimulationEventHandler::new(vec![Box::new(Moves(moves.clone()))]);
    let game_id = Uuid::from_u64_pair(seed, 0x504c_4159); // «PLAY», as play.rs
    let (outcome, turns) = {
        let mut game = Game::new_with_event_handlers(game_id, players, seed, &mut handler);
        let outcome = game.play();
        (outcome, game.get_state_clone().turn_count)
    };
    if coach {
        let values = scores.lock().expect("scores").clone().expect("a decision with a choice");
        return json!({ "scores": values.iter().map(|v| (v * 1000.0).round() / 1000.0).collect::<Vec<_>>() });
    }
    let winner = match outcome {
        Some(GameOutcome::Win(0)) => "you",
        Some(GameOutcome::Win(_)) => "bot",
        Some(GameOutcome::Tie) | None => "tie",
    };
    let moves = moves.lock().expect("moves").join("\n");
    json!({ "winner": winner, "turns": turns, "moves": fnv(&moves) })
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
        Some("values") => value_trace(&job),
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
                            "{} plays otherwise with the same GAMES_REV: raise GAMES_REV in main.rs first",
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

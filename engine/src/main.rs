//! engine-cli: the worker's front end of deckgym-core (PLAN §3.7, DECISIONES A.5). It only uses deckgym's public API
//! and never modifies it.
//!
//! Commands (JSON in and out; long commands report `total <games>` once and `progress <games done>` lines on stderr):
//!   engine-cli version                               → { engineRev, cliVersion, cards }
//!   engine-cli status                                → every engine card with its implementation status
//!   engine-cli validate <job.json>                   → per deck: valid, errors, cards not implemented
//!   engine-cli simulate <job.json> <result.json>     → one pairing: wins, losses, ties, replays
//!   engine-cli optimize <job.json> <result.json>     → every valid way to fill a deck, against a group of rivals
//!   engine-cli play <job.json>                       → one game of the owner against a bot, decisions over stdin/stdout
//!   engine-cli consistency <job.json> <result.json>  → how soon a deck has its key attacker ready (goldfish games)
//!
//! Seeds: game `i` of a job plays with `splitmix64(seed ^ splitmix64(i))`, so a job is reproducible from its seed and
//! no two games share one (deckgym's own `simulate --seed` plays every game with the same seed). Whether the engine
//! is deterministic across processes is measured, not assumed (PLAN §3.7).
//!
//! Exit codes: 0 ok · 2 bad input (bad JSON, invalid deck, unknown card) · 3 the engine failed (a game panicked).

mod coach;
mod consistency;
mod play;

use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use deckgym::card_ids::CardId;
use deckgym::card_validation::get_implementation_status;
use deckgym::database::get_card_by_enum;
use deckgym::models::Card;
use deckgym::optimize::generate_valid_combinations;
use deckgym::players::{create_players, parse_player_code, PlayerCode};
use deckgym::replay::ReplayRecorder;
use deckgym::simulation_event_handler::{
    CompositeSimulationEventHandler, GameStartMetadata, SimulationEventHandler,
};
use deckgym::state::GameOutcome;
use deckgym::{Deck, Game};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use strum::IntoEnumIterator;
use uuid::Uuid;

const ENGINE_REV: &str = env!("DECKGYM_REV");
const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------------------------------------------------------------------------------------------------------------
// Errors and output
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliError {
    error: String,
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<serde_json::Value>,
}

impl CliError {
    fn input(message: impl Into<String>) -> Self {
        CliError { error: message.into(), code: "bad_input", detail: None }
    }
    fn engine(message: impl Into<String>) -> Self {
        CliError { error: message.into(), code: "engine_failure", detail: None }
    }
    fn exit_code(&self) -> i32 {
        if self.code == "engine_failure" {
            3
        } else {
            2
        }
    }
}

fn read_job<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T, CliError> {
    let text = std::fs::read_to_string(path).map_err(|e| CliError::input(format!("no se pudo leer {path}: {e}")))?;
    serde_json::from_str(&text).map_err(|e| CliError::input(format!("JSON inválido en {path}: {e}")))
}

fn write_json<T: Serialize>(path: Option<&str>, value: &T) -> Result<(), CliError> {
    let text = serde_json::to_string(value).map_err(|e| CliError::engine(e.to_string()))?;
    match path {
        Some(path) => std::fs::write(path, text).map_err(|e| CliError::engine(format!("no se pudo escribir {path}: {e}"))),
        None => {
            println!("{text}");
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------------------------

fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Seed of game `index` of a job with seed `seed`.
fn game_seed(seed: u64, index: u64) -> u64 {
    splitmix64(seed ^ splitmix64(index))
}

// ---------------------------------------------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotImplemented {
    id: String,
    name: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeckCheck {
    /// Parsed, 20 cards, at least one Basic, selectable energies, ≤ 2 per name, every card implemented.
    simulable: bool,
    /// deckgym's own `is_valid` (size, basics, energies, names).
    valid: bool,
    cards: usize,
    energies: Vec<String>,
    errors: Vec<String>,
    not_implemented: Vec<NotImplemented>,
}

/// `Deck::from_string` panics on an unknown energy name: turn that into an input error.
fn parse_deck(text: &str) -> Result<Deck, String> {
    match catch_unwind(AssertUnwindSafe(|| Deck::from_string(text))) {
        Ok(Ok(deck)) => Ok(deck),
        Ok(Err(message)) => Err(message),
        Err(_) => Err("energía desconocida en la línea Energy:".to_string()),
    }
}

fn check_deck(text: &str) -> DeckCheck {
    let deck = match parse_deck(text) {
        Ok(deck) => deck,
        Err(error) => {
            return DeckCheck {
                simulable: false,
                valid: false,
                cards: 0,
                energies: vec![],
                errors: vec![error],
                not_implemented: vec![],
            }
        }
    };
    let mut errors = Vec::new();
    let valid = deck.is_valid();
    if !valid {
        errors.push("el motor no lo acepta: 20 cartas, un Básico, energías elegibles y 2 por nombre".to_string());
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut not_implemented = Vec::new();
    for card in &deck.cards {
        let id = card.get_id();
        if !seen.insert(id.clone()) {
            continue;
        }
        if let Some(card_id) = CardId::from_card_id(&id) {
            let status = get_implementation_status(card_id);
            if !status.is_complete() {
                not_implemented.push(NotImplemented {
                    id: id.clone(),
                    name: card.get_name(),
                    status: format!("{status:?}"),
                });
            }
        }
    }
    DeckCheck {
        simulable: valid && not_implemented.is_empty(),
        valid,
        cards: deck.cards.len(),
        energies: deck.energy_types().iter().map(|e| e.to_string()).collect(),
        errors,
        not_implemented,
    }
}

fn parse_players(codes: &[String]) -> Result<Vec<PlayerCode>, CliError> {
    if codes.len() != 2 {
        return Err(CliError::input("players: hacen falta dos códigos de bot («e2», «r»…)"));
    }
    codes
        .iter()
        .map(|code| {
            let parsed = parse_player_code(code).map_err(CliError::input)?;
            match parsed {
                PlayerCode::H | PlayerCode::X => Err(CliError::input(format!("bot «{code}» no sirve para simular"))),
                other => Ok(other),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------
// Playing games
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Winner {
    A,
    B,
    Tie,
}

struct GameRun {
    winner: Winner,
    turns: u32,
}

/// Plays one game; with `replay_dir`, writes its replay (`<game_id>.json`) through deckgym's `ReplayRecorder`.
fn play_game(
    deck_a: &Deck,
    deck_b: &Deck,
    codes: &[PlayerCode],
    seed: u64,
    game_id: Uuid,
    replay_dir: Option<&PathBuf>,
) -> Result<GameRun, String> {
    catch_unwind(AssertUnwindSafe(|| {
        let mut handlers: Vec<Box<dyn SimulationEventHandler>> = Vec::new();
        if let Some(dir) = replay_dir {
            handlers.push(Box::new(ReplayRecorder::new(dir.clone(), Arc::new(AtomicUsize::new(0)), None)));
        }
        let mut handler = CompositeSimulationEventHandler::new(handlers);
        let players = create_players(deck_a.clone(), deck_b.clone(), codes.to_vec());
        let player_names = [format!("{:?}", players[0]), format!("{:?}", players[1])];
        let decks = [players[0].get_deck(), players[1].get_deck()];
        let metadata = GameStartMetadata { seed, player_names, decks: [&decks[0], &decks[1]] };
        handler.on_game_start_with_metadata(game_id, &metadata);
        let (outcome, state) = {
            let mut game = Game::new_with_event_handlers(game_id, players, seed, &mut handler);
            let outcome = game.play();
            (outcome, game.get_state_clone())
        };
        let turns = u32::from(state.turn_count);
        handler.on_game_end(game_id, state, outcome);
        let winner = match outcome {
            Some(GameOutcome::Win(0)) => Winner::A,
            Some(GameOutcome::Win(_)) => Winner::B,
            Some(GameOutcome::Tie) | None => Winner::Tie,
        };
        GameRun { winner, turns }
    }))
    .map_err(|panic| {
        let message = panic
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "el motor falló".to_string());
        format!("la partida con semilla {seed} falló: {message}")
    })
}

/// Prints `progress <n>` on stderr every half second while games run (the worker turns it into heartbeats).
struct Progress {
    done: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Progress {
    fn start() -> Self {
        let done = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (d, s) = (done.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            let mut last = usize::MAX;
            while !s.load(Ordering::Relaxed) {
                let now = d.load(Ordering::Relaxed);
                if now != last {
                    eprintln!("progress {now}");
                    let _ = std::io::stderr().flush();
                    last = now;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
        Progress { done, stop, thread: Some(thread) }
    }

    fn tick(&self) {
        self.done.fetch_add(1, Ordering::Relaxed);
    }
}

impl Drop for Progress {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        eprintln!("progress {}", self.done.load(Ordering::Relaxed));
    }
}

fn thread_pool(threads: usize) -> Result<rayon::ThreadPool, CliError> {
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads.max(1))
        .build()
        .map_err(|e| CliError::engine(e.to_string()))
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct Tally {
    wins_a: u32,
    wins_b: u32,
    ties: u32,
    games: u32,
    turns: u64,
}

impl Tally {
    fn add(&mut self, run: &GameRun) {
        match run.winner {
            Winner::A => self.wins_a += 1,
            Winner::B => self.wins_b += 1,
            Winner::Tie => self.ties += 1,
        }
        self.games += 1;
        self.turns += u64::from(run.turns);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulateJob {
    deck_a: String,
    deck_b: String,
    players: Vec<String>,
    games: u32,
    seed: u64,
    #[serde(default = "one")]
    threads: usize,
    /// The first `replay_sample` games (by index) write their replay into `replay_dir`.
    #[serde(default)]
    replay_sample: u32,
    #[serde(default)]
    replay_dir: Option<String>,
}

fn one() -> usize {
    1
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayInfo {
    game_id: String,
    index: u32,
    /// As a string: a u64 does not fit a JSON number read by JavaScript.
    seed: String,
    file: String,
    winner: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SimulateResult {
    engine_rev: &'static str,
    cli_version: &'static str,
    players: Vec<String>,
    seed: u64,
    #[serde(flatten)]
    tally: Tally,
    duration_ms: u128,
    replays: Vec<ReplayInfo>,
}

fn winner_label(winner: Winner) -> &'static str {
    match winner {
        Winner::A => "a",
        Winner::B => "b",
        Winner::Tie => "tie",
    }
}

fn require_simulable(label: &str, text: &str) -> Result<Deck, CliError> {
    let check = check_deck(text);
    if !check.simulable {
        let mut error = CliError::input(format!("el mazo {label} no se puede simular"));
        error.detail = Some(serde_json::to_value(&check).unwrap_or_default());
        return Err(error);
    }
    parse_deck(text).map_err(CliError::input)
}

/// Game id from the seed: the same job writes the same replay file names.
fn game_id_for(seed: u64, index: u64) -> Uuid {
    Uuid::from_u64_pair(seed, index)
}

fn simulate(job: SimulateJob) -> Result<SimulateResult, CliError> {
    let deck_a = require_simulable("A", &job.deck_a)?;
    let deck_b = require_simulable("B", &job.deck_b)?;
    let codes = parse_players(&job.players)?;
    let replay_dir = job.replay_dir.as_ref().map(PathBuf::from);
    if let Some(dir) = &replay_dir {
        std::fs::create_dir_all(dir).map_err(|e| CliError::engine(format!("no se pudo crear {}: {e}", dir.display())))?;
    }
    let pool = thread_pool(job.threads)?;
    eprintln!("total {}", job.games);
    let progress = Progress::start();
    let started = Instant::now();
    let runs: Vec<Result<(u32, u64, GameRun), String>> = pool.install(|| {
        (0..job.games)
            .into_par_iter()
            .map(|index| {
                let seed = game_seed(job.seed, u64::from(index));
                let dir = if index < job.replay_sample { replay_dir.as_ref() } else { None };
                let run = play_game(&deck_a, &deck_b, &codes, seed, game_id_for(job.seed, u64::from(index)), dir);
                progress.tick();
                run.map(|run| (index, seed, run))
            })
            .collect()
    });
    let duration_ms = started.elapsed().as_millis();
    drop(progress);
    let mut tally = Tally::default();
    let mut replays = Vec::new();
    for run in runs {
        let (index, seed, run) = run.map_err(CliError::engine)?;
        tally.add(&run);
        if index < job.replay_sample {
            if let Some(dir) = &replay_dir {
                let game_id = game_id_for(job.seed, u64::from(index));
                replays.push(ReplayInfo {
                    game_id: game_id.to_string(),
                    index,
                    seed: seed.to_string(),
                    file: dir.join(format!("{game_id}.json")).display().to_string(),
                    winner: winner_label(run.winner),
                });
            }
        }
    }
    replays.sort_by_key(|replay| replay.index);
    Ok(SimulateResult {
        engine_rev: ENGINE_REV,
        cli_version: CLI_VERSION,
        players: job.players,
        seed: job.seed,
        tally,
        duration_ms,
        replays,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// optimize
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeJob {
    /// The deck with the cards that stay (fewer than 20), deckgym text with `Energy:`.
    deck: String,
    /// Candidate cards as deckgym ids: «A1 001», «P-A 007».
    candidates: Vec<String>,
    /// How many cards to add (20 − cards in `deck`).
    missing: usize,
    enemies: Vec<String>,
    games_per_enemy: u32,
    players: Vec<String>,
    seed: u64,
    #[serde(default = "one")]
    threads: usize,
    /// Safety limit: refuse more combinations than this.
    #[serde(default = "max_combinations")]
    max_combinations: usize,
}

fn max_combinations() -> usize {
    200
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CombinationResult {
    cards: Vec<String>,
    #[serde(flatten)]
    total: Tally,
    per_enemy: Vec<Tally>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeResult {
    engine_rev: &'static str,
    cli_version: &'static str,
    players: Vec<String>,
    seed: u64,
    combinations: Vec<CombinationResult>,
    duration_ms: u128,
}

fn optimize(job: OptimizeJob) -> Result<OptimizeResult, CliError> {
    let base = parse_deck(&job.deck).map_err(CliError::input)?;
    let codes = parse_players(&job.players)?;
    let mut candidates = Vec::new();
    for id in &job.candidates {
        let card_id = CardId::from_card_id(id).ok_or_else(|| CliError::input(format!("carta desconocida: {id}")))?;
        let status = get_implementation_status(card_id);
        if !status.is_complete() {
            return Err(CliError::input(format!("la carta {id} no está implementada en el motor")));
        }
        candidates.push(card_id);
    }
    let enemies: Vec<Deck> = job
        .enemies
        .iter()
        .enumerate()
        .map(|(i, text)| require_simulable(&format!("rival {}", i + 1), text))
        .collect::<Result<_, _>>()?;
    let combinations = generate_valid_combinations(&base, &candidates, job.missing);
    if combinations.is_empty() {
        return Err(CliError::input("ninguna combinación de candidatas forma un mazo válido"));
    }
    if combinations.len() > job.max_combinations {
        return Err(CliError::input(format!(
            "{} combinaciones superan el límite de {}: reducí las candidatas",
            combinations.len(),
            job.max_combinations
        )));
    }
    let decks: Vec<(Vec<String>, Deck)> = combinations
        .iter()
        .map(|combination| {
            let mut deck = base.clone();
            let mut ids = Vec::new();
            for card_id in combination {
                let card: Card = get_card_by_enum(*card_id);
                ids.push(card.get_id());
                deck.cards.push(card);
            }
            (ids, deck)
        })
        .collect();
    let pool = thread_pool(job.threads)?;
    let progress = Progress::start();
    let started = Instant::now();
    let games_per_combo = (enemies.len() as u64) * u64::from(job.games_per_enemy);
    eprintln!("total {}", games_per_combo * decks.len() as u64);
    let runs: Vec<Result<(usize, usize, GameRun), String>> = pool.install(|| {
        let tasks: Vec<(usize, usize, u32)> = (0..decks.len())
            .flat_map(|c| (0..enemies.len()).flat_map(move |e| (0..job.games_per_enemy).map(move |g| (c, e, g))))
            .collect();
        tasks
            .into_par_iter()
            .map(|(c, e, g)| {
                let index = (c as u64) * games_per_combo + (e as u64) * u64::from(job.games_per_enemy) + u64::from(g);
                let seed = game_seed(job.seed, index);
                let run = play_game(&decks[c].1, &enemies[e], &codes, seed, game_id_for(job.seed, index), None);
                progress.tick();
                run.map(|run| (c, e, run))
            })
            .collect()
    });
    let duration_ms = started.elapsed().as_millis();
    drop(progress);
    let mut results: Vec<CombinationResult> = decks
        .iter()
        .map(|(ids, _)| CombinationResult {
            cards: ids.clone(),
            total: Tally::default(),
            per_enemy: vec![Tally::default(); enemies.len()],
        })
        .collect();
    for run in runs {
        let (c, e, run) = run.map_err(CliError::engine)?;
        results[c].total.add(&run);
        results[c].per_enemy[e].add(&run);
    }
    Ok(OptimizeResult {
        engine_rev: ENGINE_REV,
        cli_version: CLI_VERSION,
        players: job.players,
        seed: job.seed,
        combinations: results,
        duration_ms,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// status, version, validate
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CardStatus {
    id: String,
    name: String,
    status: String,
    complete: bool,
}

fn status() -> Vec<CardStatus> {
    CardId::iter()
        .map(|card_id| {
            let card = get_card_by_enum(card_id);
            let status = get_implementation_status(card_id);
            CardStatus { id: card.get_id(), name: card.get_name(), status: format!("{status:?}"), complete: status.is_complete() }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
struct ValidateJob {
    decks: Vec<String>,
}

fn run(args: &[String]) -> Result<(), CliError> {
    match args.first().map(String::as_str) {
        Some("version") => write_json(
            None,
            &serde_json::json!({ "engineRev": ENGINE_REV, "cliVersion": CLI_VERSION, "cards": CardId::iter().count() }),
        ),
        Some("status") => write_json(args.get(1).map(String::as_str), &status()),
        Some("validate") => {
            let job: ValidateJob = read_job(args.get(1).ok_or_else(|| CliError::input("falta job.json"))?)?;
            let checks: Vec<DeckCheck> = job.decks.iter().map(|text| check_deck(text)).collect();
            write_json(args.get(2).map(String::as_str), &serde_json::json!({ "engineRev": ENGINE_REV, "decks": checks }))
        }
        Some("simulate") => {
            let job: SimulateJob = read_job(args.get(1).ok_or_else(|| CliError::input("falta job.json"))?)?;
            let result = simulate(job)?;
            write_json(args.get(2).map(String::as_str), &result)
        }
        Some("consistency") => {
            let job: consistency::ConsistencyJob = read_job(args.get(1).ok_or_else(|| CliError::input("falta job.json"))?)?;
            let result = consistency::consistency(job)?;
            write_json(args.get(2).map(String::as_str), &result)
        }
        Some("play") => {
            let job: play::PlayJob = read_job(args.get(1).ok_or_else(|| CliError::input("falta job.json"))?)?;
            play::play(job)
        }
        Some("optimize") => {
            let job: OptimizeJob = read_job(args.get(1).ok_or_else(|| CliError::input("falta job.json"))?)?;
            let result = optimize(job)?;
            write_json(args.get(2).map(String::as_str), &result)
        }
        _ => Err(CliError::input(
            "uso: engine-cli version | status [out.json] | validate job.json [out.json] | simulate job.json [out.json] | optimize job.json [out.json] | play job.json | consistency job.json [out.json]",
        )),
    }
}

/// Windows puts processes without a window (the worker runs hidden) in «efficiency mode» (EcoQoS) and the scheduler
/// keeps them on the efficiency cores: measured on the owner's PC, six engines shared 4 of 20 logical processors. A
/// process can opt out of that throttling for itself; nothing else changes (priority and affinity stay as they are).
#[cfg(windows)]
fn disable_power_throttling() {
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };
    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: 0,
    };
    // Best effort: an older Windows without the class just keeps its default scheduling.
    unsafe {
        SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            &state as *const PROCESS_POWER_THROTTLING_STATE as *const core::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

#[cfg(not(windows))]
fn disable_power_throttling() {}

fn main() {
    disable_power_throttling();
    // Panics inside games are caught and reported as JSON; keep the default hook from printing them twice.
    std::panic::set_hook(Box::new(|_| {}));
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = run(&args) {
        let text = serde_json::to_string(&error).unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", error.error));
        println!("{text}");
        std::process::exit(error.exit_code());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_are_reproducible_and_distinct() {
        assert_eq!(game_seed(42, 0), game_seed(42, 0));
        assert_ne!(game_seed(42, 0), game_seed(42, 1));
        assert_ne!(game_seed(42, 0), game_seed(43, 0));
        // Reference values shared with @tcg/domain (simulation/seeds.ts).
        assert_eq!(splitmix64(0), 0xE220_A839_7B1D_CDAF);
    }
}

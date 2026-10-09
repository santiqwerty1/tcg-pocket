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
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use deckgym::actions::Action;
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
use deckgym::{Deck, Game, State};
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

/// How a game ended, from its final state (deckgym checks points before the empty board, and ties at turn 31).
#[derive(Debug, Clone, Copy, PartialEq)]
enum Ending {
    /// The winner reached 3 points.
    Points,
    /// The loser had no Pokémon left in play.
    NoPokemon,
    /// The 30-turn limit: a tie.
    TurnLimit,
    /// Any other tie (both reached 3 points, or both boards emptied, on the same action).
    Tie,
}

impl Ending {
    fn of(outcome: Option<GameOutcome>, state: &State) -> Ending {
        match outcome {
            Some(GameOutcome::Win(winner)) if state.points[winner] >= 3 => Ending::Points,
            Some(GameOutcome::Win(_)) => Ending::NoPokemon,
            _ if state.turn_count > 30 => Ending::TurnLimit,
            _ => Ending::Tie,
        }
    }

    fn letter(self) -> char {
        match self {
            Ending::Points => 'P',
            Ending::NoPokemon => 'N',
            Ending::TurnLimit => 'L',
            Ending::Tie => 'T',
        }
    }
}

struct GameRun {
    winner: Winner,
    turns: u32,
    /// Who plays turn 1 (0 = deck A): deckgym's coin flip when the game is set up.
    starter: usize,
    ending: Ending,
    /// Highest stage each side had in play (0 Basic, 1, 2); only watched with `details`.
    stages: [u8; 2],
}

/// The highest stage each side has had in play, looked at before every action and at the end of the game.
struct StageWatch {
    max: Arc<[AtomicU8; 2]>,
}

impl StageWatch {
    fn note(&self, state: &State) {
        for (player, slots) in state.in_play_pokemon.iter().enumerate() {
            for played in slots.iter().flatten() {
                if let Card::Pokemon(pokemon) = &played.card {
                    self.max[player].fetch_max(pokemon.stage, Ordering::Relaxed);
                }
            }
        }
    }
}

impl SimulationEventHandler for StageWatch {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, state: &State, _actor: usize, _playable: &[Action], _action: &Action) {
        self.note(state);
    }

    fn on_game_end(&mut self, _game_id: Uuid, state: State, _result: Option<GameOutcome>) {
        self.note(&state);
    }
}

/// Plays one game; with `replay_dir`, writes its replay (`<game_id>.json`) through deckgym's `ReplayRecorder`; with
/// `details`, also watches the highest stage of each side (what `perGame` reports).
fn play_game(
    deck_a: &Deck,
    deck_b: &Deck,
    codes: &[PlayerCode],
    seed: u64,
    game_id: Uuid,
    replay_dir: Option<&PathBuf>,
    details: bool,
) -> Result<GameRun, String> {
    catch_unwind(AssertUnwindSafe(|| {
        let mut handlers: Vec<Box<dyn SimulationEventHandler>> = Vec::new();
        if let Some(dir) = replay_dir {
            handlers.push(Box::new(ReplayRecorder::new(dir.clone(), Arc::new(AtomicUsize::new(0)), None)));
        }
        let stages = Arc::new([AtomicU8::new(0), AtomicU8::new(0)]);
        if details {
            handlers.push(Box::new(StageWatch { max: stages.clone() }));
        }
        let mut handler = CompositeSimulationEventHandler::new(handlers);
        let players = create_players(deck_a.clone(), deck_b.clone(), codes.to_vec());
        let player_names = [format!("{:?}", players[0]), format!("{:?}", players[1])];
        let decks = [players[0].get_deck(), players[1].get_deck()];
        let metadata = GameStartMetadata { seed, player_names, decks: [&decks[0], &decks[1]] };
        handler.on_game_start_with_metadata(game_id, &metadata);
        let (outcome, state, starter) = {
            let mut game = Game::new_with_event_handlers(game_id, players, seed, &mut handler);
            // The setup starts with the player that won the coin flip, and turn 1 goes back to them.
            let starter = game.get_state_clone().current_player;
            let outcome = game.play();
            (outcome, game.get_state_clone(), starter)
        };
        let turns = u32::from(state.turn_count);
        let ending = Ending::of(outcome, &state);
        handler.on_game_end(game_id, state, outcome);
        let winner = match outcome {
            Some(GameOutcome::Win(0)) => Winner::A,
            Some(GameOutcome::Win(_)) => Winner::B,
            Some(GameOutcome::Tie) | None => Winner::Tie,
        };
        let stages = [stages[0].load(Ordering::Relaxed), stages[1].load(Ordering::Relaxed)];
        GameRun { winner, turns, starter, ending, stages }
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
/// The thread waits on a channel, not a sleep: dropping the sender wakes it at once, so a short run does not wait out
/// the rest of a half second before exiting (H-019: 2 games took ~0,58 s, ~0,06 s of them playing).
struct Progress {
    done: Arc<AtomicUsize>,
    stop: Option<mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Progress {
    fn start() -> Self {
        let done = Arc::new(AtomicUsize::new(0));
        let (stop, stopped) = mpsc::channel::<()>();
        let d = done.clone();
        let thread = std::thread::spawn(move || {
            let mut last = usize::MAX;
            loop {
                let now = d.load(Ordering::Relaxed);
                if now != last {
                    eprintln!("progress {now}");
                    let _ = std::io::stderr().flush();
                    last = now;
                }
                match stopped.recv_timeout(Duration::from_millis(500)) {
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    _ => break,
                }
            }
        });
        Progress { done, stop: Some(stop), thread: Some(thread) }
    }

    fn tick(&self) {
        self.done.fetch_add(1, Ordering::Relaxed);
    }
}

impl Drop for Progress {
    fn drop(&mut self) {
        drop(self.stop.take());
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
    /// Also report each game by index (`perGame`, `starters`): the Laboratorio pairs games played with the same seed.
    #[serde(default)]
    per_game: bool,
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
    /// Only with `perGame` in the job.
    #[serde(skip_serializing_if = "Option::is_none")]
    per_game: Option<PerGame>,
}

/// Each game of a job by index (game `i` played with `game_seed(seed, i)`), one character or number per game.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PerGame {
    /// «A» deck A won, «B» deck B won, «T» tie.
    winners: String,
    /// Who played turn 1: «A» or «B».
    starters: String,
    /// «P» the winner reached 3 points, «N» the loser had no Pokémon in play, «L» tie at the 30-turn limit, «T» other tie.
    endings: String,
    /// Turns played (deckgym's global turn count: both players' turns).
    turns: Vec<u32>,
    /// Highest stage deck A had in play: «0» only Basic, «1», «2».
    stages_a: String,
    /// The same for deck B.
    stages_b: String,
}

impl PerGame {
    fn with_capacity(games: usize) -> Self {
        PerGame {
            winners: String::with_capacity(games),
            starters: String::with_capacity(games),
            endings: String::with_capacity(games),
            turns: Vec::with_capacity(games),
            stages_a: String::with_capacity(games),
            stages_b: String::with_capacity(games),
        }
    }

    fn push(&mut self, run: &GameRun) {
        self.winners.push(winner_letter(run.winner));
        self.starters.push(if run.starter == 0 { 'A' } else { 'B' });
        self.endings.push(run.ending.letter());
        self.turns.push(run.turns);
        self.stages_a.push(char::from(b'0' + run.stages[0].min(9)));
        self.stages_b.push(char::from(b'0' + run.stages[1].min(9)));
    }
}

fn winner_letter(winner: Winner) -> char {
    match winner {
        Winner::A => 'A',
        Winner::B => 'B',
        Winner::Tie => 'T',
    }
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
                let game_id = game_id_for(job.seed, u64::from(index));
                let run = play_game(&deck_a, &deck_b, &codes, seed, game_id, dir, job.per_game);
                progress.tick();
                run.map(|run| (index, seed, run))
            })
            .collect()
    });
    let duration_ms = started.elapsed().as_millis();
    drop(progress);
    let mut tally = Tally::default();
    let mut replays = Vec::new();
    // `collect` keeps the order of the indices, so the letters line up with games 0, 1, 2…
    let mut per_game = job.per_game.then(|| PerGame::with_capacity(job.games as usize));
    for run in runs {
        let (index, seed, run) = run.map_err(CliError::engine)?;
        tally.add(&run);
        if let Some(per_game) = per_game.as_mut() {
            per_game.push(&run);
        }
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
        per_game,
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
                let run = play_game(&decks[c].1, &enemies[e], &codes, seed, game_id_for(job.seed, index), None, false);
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

    fn job(games: u32, per_game: bool) -> SimulateJob {
        SimulateJob {
            deck_a: crate::coach::tests::ALTARIA.to_string(),
            deck_b: crate::coach::tests::ALTARIA.to_string(),
            players: vec!["r".to_string(), "r".to_string()],
            games,
            seed: 20261009,
            threads: 2,
            replay_sample: 0,
            replay_dir: None,
            per_game,
        }
    }

    #[test]
    fn per_game_lines_up_with_the_tally_and_repeats_with_the_seed() {
        let result = simulate(job(24, true)).expect("simulate");
        let games = result.per_game.as_ref().expect("perGame");
        for text in [&games.winners, &games.starters, &games.endings, &games.stages_a, &games.stages_b] {
            assert_eq!(text.len(), 24);
        }
        assert_eq!(games.turns.len(), 24);
        let count = |text: &str, letter: char| text.chars().filter(|c| *c == letter).count() as u32;
        assert_eq!(count(&games.winners, 'A'), result.tally.wins_a);
        assert_eq!(count(&games.winners, 'B'), result.tally.wins_b);
        assert_eq!(count(&games.winners, 'T'), result.tally.ties);
        assert_eq!(games.turns.iter().map(|t| u64::from(*t)).sum::<u64>(), result.tally.turns);
        assert!(games.starters.chars().all(|c| c == 'A' || c == 'B'));
        assert!(count(&games.starters, 'A') > 0 && count(&games.starters, 'B') > 0, "24 coin flips: {}", games.starters);
        // A win ends on points or an empty board, a tie on the limit or a tie; ties at the limit played 31 turns.
        for (i, (winner, ending)) in games.winners.chars().zip(games.endings.chars()).enumerate() {
            match winner {
                'T' => assert!(ending == 'L' || ending == 'T', "game {i}: {ending}"),
                _ => assert!(ending == 'P' || ending == 'N', "game {i}: {ending}"),
            }
            if ending == 'L' {
                assert!(games.turns[i] > 30);
            }
        }
        // Altaria evolves Swablu (stage 1): random bots get there in some games, and never past stage 2.
        assert!(games.stages_a.chars().chain(games.stages_b.chars()).all(|c| ('0'..='2').contains(&c)));
        assert!(games.stages_a.contains('1') || games.stages_b.contains('1'), "{} {}", games.stages_a, games.stages_b);
        let again = simulate(job(24, true)).expect("simulate");
        let text = |result: &SimulateResult| serde_json::to_string(&result.per_game).expect("json");
        assert_eq!(text(&again), text(&result));
        // Without the flag nothing is added to the result.
        let plain = simulate(job(4, false)).expect("simulate");
        assert!(plain.per_game.is_none());
        assert!(!serde_json::to_string(&plain).expect("json").contains("perGame"));
    }

    #[test]
    fn each_game_is_the_same_whatever_the_threads_and_the_length_of_the_job() {
        // Game i depends only on the job's seed and i: 12 games on 1 thread are the first 12 of 24 on 4 threads.
        let short = simulate(SimulateJob { threads: 1, ..job(12, true) }).expect("simulate");
        let long = simulate(SimulateJob { threads: 4, ..job(24, true) }).expect("simulate");
        let (short, long) = (short.per_game.expect("perGame"), long.per_game.expect("perGame"));
        let prefix = |text: &str| text[..12].to_string();
        assert_eq!(short.winners, prefix(&long.winners));
        assert_eq!(short.starters, prefix(&long.starters));
        assert_eq!(short.endings, prefix(&long.endings));
        assert_eq!(short.stages_a, prefix(&long.stages_a));
        assert_eq!(short.stages_b, prefix(&long.stages_b));
        assert_eq!(short.turns[..], long.turns[..12]);
    }

    #[test]
    fn the_starter_is_who_plays_turn_one() {
        let deck = Deck::from_string(crate::coach::tests::ALTARIA).expect("deck");
        for seed in 0..12 {
            let players = create_players(deck.clone(), deck.clone(), vec![PlayerCode::R, PlayerCode::R]);
            let mut game = Game::new(players, seed);
            let starter = game.get_state_clone().current_player;
            while game.get_state_clone().turn_count == 0 {
                game.play_tick();
            }
            assert_eq!(game.get_state_clone().current_player, starter, "seed {seed}");
        }
    }
}

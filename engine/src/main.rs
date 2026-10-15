//! engine-cli: the worker's front end of deckgym-core (PLAN §3.7, DECISIONES A.5). It only uses deckgym's public API
//! and never modifies it.
//!
//! Commands (JSON in and out; long commands report `total <games>` once and `progress <games done>` lines on stderr):
//!   engine-cli version                               → { engineRev, cliVersion, cards }
//!   engine-cli status                                → every engine card with its implementation status
//!   engine-cli validate <job.json>                   → per deck: valid, errors, cards not implemented
//!   engine-cli simulate <job.json> <result.json>     → one pairing: wins, losses, ties, replays
//!   engine-cli batch <job.json> <result.json>        → several pairings of one job, on one pool of threads
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
mod exit;
mod fair_bot;
mod g_bot;
// The browser's engine (engine/wasm) also uses what engine-cli does not (the coach's restore, the played steps).
#[allow(dead_code)]
mod live;
mod play;
// Its policy and accounts are platform-free (and tested everywhere); only Windows runs them.
#[cfg_attr(not(windows), allow(dead_code))]
mod regulate;
mod resume;
mod seeds;

use std::collections::HashMap;
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
use deckgym::players::PlayerCode;
use deckgym::replay::ReplayRecorder;
use deckgym::simulation_event_handler::{
    CompositeSimulationEventHandler, GameStartMetadata, SimulationEventHandler,
};
use deckgym::state::GameOutcome;
use deckgym::{Deck, Game, State};
use fair_bot::{create_players, parse_bot_code, BotCode};
use rayon::prelude::*;
use seeds::{game_seed, GAMES_REV};
#[cfg(test)]
use seeds::splitmix64;
use serde::{Deserialize, Serialize};
use strum::IntoEnumIterator;
use uuid::Uuid;

const ENGINE_REV: &str = env!("DECKGYM_REV");
const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Phase 42: a fingerprint of the code that plays (build.rs). The exact cache of chunks reuses a result only with it.
const ENGINE_BUILD: &str = env!("ENGINE_BUILD");
/// What the worker and the queue can ask of this engine beyond the commands of 0.1.0: `perGame` (H-010, T-017 A2),
/// `batch`, several pairings in one process (B2), and `fairBots`, the f<N> bots (H-018).
/// «etBot» (H-051): the bot that ends its turn, which deckgym's own parser never reaches.
/// `regulate` (the CPU regulator) only where it works: Windows; `regulatePing`, a regulator that answers the worker's
/// `ping` (0.3.11, review of #106: a hung one is noticed). `gBots`: the g<N> bots (docs/BOTS.md).
#[cfg(windows)]
const FEATURES: [&str; 8] = ["perGame", "batch", "fairBots", "etBot", "resume", "regulate", "regulatePing", "gBots"];
#[cfg(not(windows))]
const FEATURES: [&str; 6] = ["perGame", "batch", "fairBots", "etBot", "resume", "gBots"];
/// deckgym ties a game when turn 31 begins (`State::advance_turn`): reported so the app does not hard-code it.
const TURN_LIMIT: u32 = 30;

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

fn parse_players(codes: &[String]) -> Result<Vec<BotCode>, CliError> {
    if codes.len() != 2 {
        return Err(CliError::input("players: hacen falta dos códigos de bot («e2», «r»…)"));
    }
    codes
        .iter()
        .map(|code| {
            let parsed = parse_bot_code(code).map_err(CliError::input)?;
            match parsed {
                BotCode::Deckgym(PlayerCode::H | PlayerCode::X) => {
                    Err(CliError::input(format!("bot «{code}» no sirve para simular")))
                }
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

/// A game as a checkpoint keeps it (`resume`): the winner, who started and how it ended (`A0P`), its turns and both
/// highest stages (`21`): what the result says of each game.
fn game_line(run: &GameRun) -> String {
    format!(
        "{}{}{} {} {}{}",
        winner_letter(run.winner),
        run.starter,
        run.ending.letter(),
        run.turns,
        run.stages[0].min(9),
        run.stages[1].min(9)
    )
}

/// The game a checkpoint line says (`game_line`); None for anything else.
fn game_of_line(text: &str) -> Option<GameRun> {
    let mut parts = text.split(' ');
    let (head, turns, stages) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let head: Vec<char> = head.chars().collect();
    let stages: Vec<u8> = stages.chars().map(|c| c.to_digit(10).map(|d| d as u8)).collect::<Option<_>>()?;
    let [winner, starter, ending] = head.as_slice() else { return None };
    let [stage_a, stage_b] = stages.as_slice() else { return None };
    Some(GameRun {
        winner: match winner {
            'A' => Winner::A,
            'B' => Winner::B,
            'T' => Winner::Tie,
            _ => return None,
        },
        starter: match starter {
            '0' => 0,
            '1' => 1,
            _ => return None,
        },
        ending: match ending {
            'P' => Ending::Points,
            'N' => Ending::NoPokemon,
            'L' => Ending::TurnLimit,
            'T' => Ending::Tie,
            _ => return None,
        },
        turns: turns.parse().ok()?,
        stages: [*stage_a, *stage_b],
    })
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
    codes: &[BotCode],
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
        Self::start_at(0)
    }

    /// From `done` games already played (a resumed pairing, `resume`).
    fn start_at(done: usize) -> Self {
        let done = Arc::new(AtomicUsize::new(done));
        let (stop, stopped) = mpsc::channel::<()>();
        let d = done.clone();
        let thread = std::thread::spawn(move || {
            let mut last = usize::MAX;
            loop {
                let now = d.load(Ordering::Relaxed);
                if now != last {
                    exit::line(&format!("progress {now}"));
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
        exit::line(&format!("progress {}", self.done.load(Ordering::Relaxed)));
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
    /// `resume` (H-054): the file of its finished games; a run of the same job plays only the ones it does not have.
    #[serde(default)]
    checkpoint: Option<String>,
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
    build: &'static str,
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
/// No `Default`: an empty one would say `turnLimit: 0` (built with `with_capacity`, which sets the real limit).
#[derive(Debug, Serialize)]
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
    /// More turns than this and the game is a tie («L»).
    turn_limit: u32,
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
            turn_limit: TURN_LIMIT,
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

/// One pairing to play: `games` games of deck A against deck B from `seed`, the first `replay_sample` recorded.
#[derive(Clone)]
struct Pairing {
    deck_a: Deck,
    deck_b: Deck,
    games: u32,
    seed: u64,
    replay_sample: u32,
    replay_dir: Option<PathBuf>,
    /// `resume`: the file of its finished games, and what names the job in it (its decks and players).
    checkpoint: Option<PathBuf>,
    job_key: String,
}

impl Pairing {
    /// The first line of its checkpoint: a file of another job (or engine) is started again.
    fn checkpoint_header(&self, per_game: bool) -> String {
        format!(
            "# engine-cli {CLI_VERSION} {ENGINE_BUILD} seed {} games {} replays {} perGame {} job {}",
            self.seed, self.games, self.replay_sample, u8::from(per_game), self.job_key
        )
    }
}

/// What names a pairing's job in its checkpoint: its decks and players.
fn job_key(deck_a: &str, deck_b: &str, players: &[String]) -> String {
    resume::fnv(&format!("{deck_a}\n--\n{deck_b}\n--\n{}", players.join(",")))
}

struct PairingOutcome {
    tally: Tally,
    replays: Vec<ReplayInfo>,
    per_game: Option<PerGame>,
    /// The first game of the pairing that failed (by index): the pairing has no result, the others still do.
    error: Option<String>,
}

/// Plays every game of every pairing on one pool of `threads` threads: a batch keeps the threads busy until its last
/// game instead of waiting on the slowest game of each pairing (B2). Each game keeps the seed it has on its own, and
/// a game that fails (a panic in deckgym) fails its pairing only.
fn play_pairings(
    pairings: &[Pairing],
    codes: &[BotCode],
    threads: usize,
    per_game: bool,
) -> Result<(Vec<PairingOutcome>, u128), CliError> {
    for dir in pairings.iter().filter_map(|pairing| pairing.replay_dir.as_ref()) {
        std::fs::create_dir_all(dir).map_err(|e| CliError::engine(format!("no se pudo crear {}: {e}", dir.display())))?;
    }
    // `resume`: the games each pairing's checkpoint already has (they are not played again), and where the rest go.
    let mut checkpoints: Vec<Option<resume::Checkpoint>> = Vec::with_capacity(pairings.len());
    let mut played: Vec<HashMap<u32, GameRun>> = Vec::with_capacity(pairings.len());
    for pairing in pairings {
        let Some(path) = &pairing.checkpoint else {
            checkpoints.push(None);
            played.push(HashMap::new());
            continue;
        };
        let header = pairing.checkpoint_header(per_game);
        match resume::Checkpoint::open(path, &header, pairing.games, |line| game_of_line(line).is_some()) {
            Ok((checkpoint, lines)) => {
                played.push(lines.iter().filter_map(|(index, line)| Some((*index, game_of_line(line)?))).collect());
                checkpoints.push(Some(checkpoint));
            }
            // A checkpoint that cannot be opened is no reason to fail the games: they are played without it.
            Err(message) => {
                exit::line(&format!("avance {message}"));
                played.push(HashMap::new());
                checkpoints.push(None);
            }
        }
    }
    let pool = thread_pool(threads)?;
    let total: usize = pairings.iter().map(|pairing| pairing.games as usize).sum();
    let tasks: Vec<(usize, u32)> = pairings
        .iter()
        .enumerate()
        .flat_map(|(p, pairing)| {
            let done = &played[p];
            (0..pairing.games).filter(move |index| !done.contains_key(index)).map(move |index| (p, index))
        })
        .collect();
    exit::line(&format!("total {total}"));
    let progress = Progress::start_at(total - tasks.len());
    let started = Instant::now();
    let runs: Vec<Result<GameRun, String>> = pool.install(|| {
        tasks
            .par_iter()
            .map(|&(p, index)| {
                let pairing = &pairings[p];
                let seed = game_seed(pairing.seed, u64::from(index));
                let dir = if index < pairing.replay_sample { pairing.replay_dir.as_ref() } else { None };
                let game_id = game_id_for(pairing.seed, u64::from(index));
                let run = play_game(&pairing.deck_a, &pairing.deck_b, codes, seed, game_id, dir, per_game);
                // After its replay: a game in the checkpoint has everything it left.
                if let (Ok(game), Some(checkpoint)) = (&run, &checkpoints[p]) {
                    checkpoint.record(index, &game_line(game), started.elapsed().as_millis());
                }
                progress.tick();
                run
            })
            .collect()
    });
    // The time of the runs before counts: the result says how long its games took to play.
    let before_ms = checkpoints.iter().flatten().map(resume::Checkpoint::base_ms).max().unwrap_or(0);
    let duration_ms = before_ms + started.elapsed().as_millis();
    drop(progress);
    let mut fresh: Vec<HashMap<u32, Result<GameRun, String>>> = pairings.iter().map(|_| HashMap::new()).collect();
    for (&(p, index), run) in tasks.iter().zip(runs) {
        fresh[p].insert(index, run);
    }
    let mut outcomes: Vec<PairingOutcome> = pairings
        .iter()
        .map(|pairing| PairingOutcome {
            tally: Tally::default(),
            replays: Vec::new(),
            per_game: per_game.then(|| PerGame::with_capacity(pairing.games as usize)),
            error: None,
        })
        .collect();
    // Each pairing's games 0, 1, 2… in order, whether played now or before: the letters line up with the indexes.
    for (p, pairing) in pairings.iter().enumerate() {
        let outcome = &mut outcomes[p];
        for index in 0..pairing.games {
            let run = match played[p].remove(&index) {
                Some(run) => Ok(run),
                None => fresh[p].remove(&index).unwrap_or_else(|| Err(format!("falta la partida {index}"))),
            };
            let run = match run {
                Ok(run) => run,
                Err(message) => {
                    // The first game of the pairing that failed (by index): the pairing has no result.
                    outcome.error = Some(message);
                    break;
                }
            };
            outcome.tally.add(&run);
            if let Some(per_game) = outcome.per_game.as_mut() {
                per_game.push(&run);
            }
            if index < pairing.replay_sample {
                if let Some(dir) = &pairing.replay_dir {
                    let game_id = game_id_for(pairing.seed, u64::from(index));
                    outcome.replays.push(ReplayInfo {
                        game_id: game_id.to_string(),
                        index,
                        seed: game_seed(pairing.seed, u64::from(index)).to_string(),
                        file: dir.join(format!("{game_id}.json")).display().to_string(),
                        winner: winner_label(run.winner),
                    });
                }
            }
        }
    }
    Ok((outcomes, duration_ms))
}

fn simulate(job: SimulateJob) -> Result<SimulateResult, CliError> {
    let pairing = Pairing {
        deck_a: require_simulable("A", &job.deck_a)?,
        deck_b: require_simulable("B", &job.deck_b)?,
        games: job.games,
        seed: job.seed,
        replay_sample: job.replay_sample,
        replay_dir: job.replay_dir.as_ref().map(PathBuf::from),
        checkpoint: job.checkpoint.as_ref().map(PathBuf::from),
        job_key: job_key(&job.deck_a, &job.deck_b, &job.players),
    };
    let codes = parse_players(&job.players)?;
    let (mut outcomes, duration_ms) = play_pairings(std::slice::from_ref(&pairing), &codes, job.threads, job.per_game)?;
    let outcome = outcomes.remove(0);
    if let Some(message) = outcome.error {
        return Err(CliError::engine(message));
    }
    Ok(SimulateResult {
        engine_rev: ENGINE_REV,
        cli_version: CLI_VERSION,
        build: ENGINE_BUILD,
        players: job.players,
        seed: job.seed,
        tally: outcome.tally,
        duration_ms,
        replays: outcome.replays,
        per_game: outcome.per_game,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchPairing {
    deck_a: String,
    deck_b: String,
    games: u32,
    seed: u64,
    #[serde(default)]
    replay_sample: u32,
    /// `resume`: this pairing's own checkpoint, as `simulate`'s.
    #[serde(default)]
    checkpoint: Option<String>,
}

/// Several pairings of one job (same bots) in one process: what `simulate` would give for each, played together.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchJob {
    pairings: Vec<BatchPairing>,
    players: Vec<String>,
    #[serde(default = "one")]
    threads: usize,
    /// Pairing `i` writes its replays into `<replay_dir>/<i>` (pairings of a Laboratorio round can share a seed).
    #[serde(default)]
    replay_dir: Option<String>,
    #[serde(default)]
    per_game: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchPairingResult {
    seed: u64,
    #[serde(flatten)]
    tally: Tally,
    replays: Vec<ReplayInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    per_game: Option<PerGame>,
    /// Why this pairing has no result (a deck that cannot be played, a game that failed); its tally is empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<CliError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchResult {
    engine_rev: &'static str,
    cli_version: &'static str,
    build: &'static str,
    players: Vec<String>,
    /// For the whole batch: the pairings played at the same time.
    duration_ms: u128,
    pairings: Vec<BatchPairingResult>,
}

fn batch(job: BatchJob) -> Result<BatchResult, CliError> {
    if job.pairings.is_empty() {
        return Err(CliError::input("pairings: hace falta al menos un cruce"));
    }
    // Two pairings writing one checkpoint would mix their games (review of `resume`).
    let mut checkpoints: Vec<&str> = job.pairings.iter().filter_map(|pairing| pairing.checkpoint.as_deref()).collect();
    checkpoints.sort_unstable();
    if checkpoints.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(CliError::input("pairings: dos cruces no pueden compartir el archivo de avance"));
    }
    let codes = parse_players(&job.players)?;
    let root = job.replay_dir.as_ref().map(PathBuf::from);
    // A deck that cannot be played fails its own pairing only, like a game that fails.
    let checked: Vec<Result<Pairing, CliError>> = job
        .pairings
        .iter()
        .enumerate()
        .map(|(i, item)| {
            Ok(Pairing {
                deck_a: require_simulable(&format!("A del cruce {}", i + 1), &item.deck_a)?,
                deck_b: require_simulable(&format!("B del cruce {}", i + 1), &item.deck_b)?,
                games: item.games,
                seed: item.seed,
                replay_sample: item.replay_sample,
                replay_dir: root.as_ref().filter(|_| item.replay_sample > 0).map(|dir| dir.join(i.to_string())),
                checkpoint: item.checkpoint.as_ref().map(PathBuf::from),
                job_key: job_key(&item.deck_a, &item.deck_b, &job.players),
            })
        })
        .collect();
    let (playable, refused): (Vec<_>, Vec<_>) = checked.into_iter().enumerate().partition(|(_, pairing)| pairing.is_ok());
    let playable: Vec<(usize, Pairing)> =
        playable.into_iter().map(|(i, pairing)| (i, pairing.unwrap_or_else(|_| unreachable!()))).collect();
    let pairings: Vec<Pairing> = playable.iter().map(|(_, pairing)| pairing.clone()).collect();
    let (outcomes, duration_ms) = play_pairings(&pairings, &codes, job.threads, job.per_game)?;
    let mut results: Vec<Option<BatchPairingResult>> = (0..job.pairings.len()).map(|_| None).collect();
    for ((i, pairing), outcome) in playable.iter().zip(outcomes) {
        let failed = outcome.error.is_some();
        results[*i] = Some(BatchPairingResult {
            seed: pairing.seed,
            tally: if failed { Tally::default() } else { outcome.tally },
            replays: if failed { Vec::new() } else { outcome.replays },
            per_game: if failed { None } else { outcome.per_game },
            error: outcome.error.map(CliError::engine),
        });
    }
    for (i, pairing) in refused {
        results[i] = Some(BatchPairingResult {
            seed: job.pairings[i].seed,
            tally: Tally::default(),
            replays: Vec::new(),
            per_game: None,
            error: pairing.err(),
        });
    }
    Ok(BatchResult {
        engine_rev: ENGINE_REV,
        cli_version: CLI_VERSION,
        build: ENGINE_BUILD,
        players: job.players,
        duration_ms,
        pairings: results.into_iter().map(|result| result.unwrap_or_else(|| unreachable!())).collect(),
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
    build: &'static str,
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
    exit::line(&format!("total {}", games_per_combo * decks.len() as u64));
    let runs: Vec<Result<(usize, usize, GameRun), String>> = pool.install(|| {
        let tasks: Vec<(usize, usize, u32)> = (0..decks.len())
            .flat_map(|c| (0..enemies.len()).flat_map(move |e| (0..job.games_per_enemy).map(move |g| (c, e, g))))
            .collect();
        tasks
            .into_par_iter()
            .map(|(c, e, g)| {
                // Common seeds (C8 of the optimization review): game g against enemy e has the same seed for every
                // combination, so two combinations are compared on the same shuffles and coin flips.
                let index = (e as u64) * u64::from(job.games_per_enemy) + u64::from(g);
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
        build: ENGINE_BUILD,
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
            &serde_json::json!({
                "engineRev": ENGINE_REV,
                "cliVersion": CLI_VERSION,
                "build": ENGINE_BUILD,
                "gamesRev": GAMES_REV,
                "cards": CardId::iter().count(),
                "features": FEATURES,
            }),
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
        Some("batch") => {
            let job: BatchJob = read_job(args.get(1).ok_or_else(|| CliError::input("falta job.json"))?)?;
            let result = batch(job)?;
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
        Some("regulate") => regulate::regulate(&args[1..]).map_err(CliError::input),
        _ => Err(CliError::input(
            "uso: engine-cli version | status [out.json] | validate job.json [out.json] | simulate job.json [out.json] | batch job.json [out.json] | optimize job.json [out.json] | play job.json | consistency job.json [out.json] | regulate [--max N] [--floor N] [--every-ms N] [--trace]",
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
    // How it ends goes on stderr as its last line (H-054): before anything else can end it.
    exit::install();
    disable_power_throttling();
    // Panics inside games are caught and reported as JSON; keep the default hook from printing them twice.
    std::panic::set_hook(Box::new(|_| {}));
    let args: Vec<String> = std::env::args().skip(1).collect();
    match catch_unwind(AssertUnwindSafe(|| run(&args))) {
        Ok(Ok(())) => exit::finish("ok"),
        Ok(Err(error)) => {
            let text = serde_json::to_string(&error).unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", error.error));
            // Without a panic: a stdout that cannot be written does not hide how it ended (review of #100).
            let _ = std::io::Write::write_all(&mut std::io::stdout().lock(), format!("{text}\n").as_bytes());
            exit::finish(&format!("error {}", error.exit_code()));
            std::process::exit(error.exit_code());
        }
        // Outside a game (where they are caught and reported): the exit code a panic has always had.
        Err(_) => {
            exit::finish("pánico");
            std::process::exit(101);
        }
    }
}

#[cfg(test)]
mod games_rev_tests;

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
            checkpoint: None,
        }
    }

    #[test]
    fn every_result_names_the_build_that_played_it() {
        assert_eq!(ENGINE_BUILD.len(), 16);
        assert!(ENGINE_BUILD.chars().all(|c| c.is_ascii_hexdigit()));
        let result = simulate(job(2, false)).expect("simulate");
        assert_eq!(serde_json::to_value(&result).expect("json")["build"], ENGINE_BUILD);
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
            assert_eq!(ending == 'L', games.turns[i] > games.turn_limit, "game {i}: {ending} in {} turns", games.turns[i]);
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
    fn a_batch_gives_each_pairing_what_it_gives_on_its_own() {
        let altaria = crate::coach::tests::ALTARIA.to_string();
        // Two pairings share a seed, as a Laboratorio variant and its incumbent do against the same rival.
        let items = [(9, 20261009), (5, 20261010), (7, 20261009)];
        let together = BatchJob {
            pairings: items
                .iter()
                .map(|&(games, seed)| BatchPairing {
                    deck_a: altaria.clone(),
                    deck_b: altaria.clone(),
                    games,
                    seed,
                    replay_sample: 0,
                    checkpoint: None,
                })
                .collect(),
            players: vec!["r".to_string(), "r".to_string()],
            threads: 3,
            replay_dir: None,
            per_game: true,
        };
        let result = batch(together).expect("batch");
        assert_eq!(result.pairings.len(), 3);
        for (&(games, seed), got) in items.iter().zip(&result.pairings) {
            let alone = simulate(SimulateJob { seed, ..job(games, true) }).expect("simulate");
            assert_eq!(got.seed, seed);
            assert_eq!(got.tally.games, games);
            assert_eq!(serde_json::to_string(&got.tally).unwrap(), serde_json::to_string(&alone.tally).unwrap());
            assert_eq!(serde_json::to_string(&got.per_game).unwrap(), serde_json::to_string(&alone.per_game).unwrap());
        }
        assert!(batch(BatchJob { pairings: vec![], ..job_of_batch() }).is_err());
    }

    #[test]
    fn a_pairing_that_fails_fails_alone_and_the_others_keep_their_results() {
        let altaria = crate::coach::tests::ALTARIA.to_string();
        // 19 cards: deckgym will not play it.
        let short: String = altaria.lines().take(altaria.lines().count() - 1).collect::<Vec<_>>().join("\n");
        let pairing = |deck_b: &str, seed: u64| BatchPairing {
            deck_a: altaria.clone(),
            deck_b: deck_b.to_string(),
            games: 6,
            seed,
            replay_sample: 0,
            checkpoint: None,
        };
        let result = batch(BatchJob {
            pairings: vec![pairing(&altaria, 1), pairing(&short, 2), pairing(&altaria, 3)],
            ..job_of_batch()
        })
        .expect("batch");
        assert!(result.pairings[0].error.is_none() && result.pairings[2].error.is_none());
        let error = result.pairings[1].error.as_ref().expect("the short deck fails");
        assert_eq!(error.code, "bad_input");
        assert!(error.error.contains("cruce 2"), "{}", error.error);
        assert_eq!(result.pairings[1].tally.games, 0);
        assert_eq!(result.pairings[0].tally.games, 6);
        let alone = simulate(SimulateJob { seed: 3, threads: 1, ..job(6, false) }).expect("simulate");
        assert_eq!(serde_json::to_string(&result.pairings[2].tally).unwrap(), serde_json::to_string(&alone.tally).unwrap());
        let text = serde_json::to_string(&result).expect("json");
        assert!(text.contains("\"error\":{\"error\":"), "{text}");
    }

    #[test]
    fn a_batch_writes_each_pairing_replays_in_its_folder_with_the_ids_and_seeds_of_simulate() {
        let dir = std::env::temp_dir().join(format!("engine-cli-batch-{}", std::process::id()));
        let altaria = crate::coach::tests::ALTARIA.to_string();
        let pairing = |seed: u64| BatchPairing {
            deck_a: altaria.clone(),
            deck_b: altaria.clone(),
            games: 3,
            seed,
            replay_sample: 2,
            checkpoint: None,
        };
        let together = batch(BatchJob {
            pairings: vec![pairing(7), pairing(7)],
            replay_dir: Some(dir.join("batch").display().to_string()),
            ..job_of_batch()
        })
        .expect("batch");
        let alone = simulate(SimulateJob {
            seed: 7,
            replay_sample: 2,
            replay_dir: Some(dir.join("alone").display().to_string()),
            ..job(3, false)
        })
        .expect("simulate");
        for (i, got) in together.pairings.iter().enumerate() {
            assert_eq!(got.replays.len(), 2);
            for (replay, expected) in got.replays.iter().zip(&alone.replays) {
                assert_eq!((replay.game_id.as_str(), replay.seed.as_str()), (expected.game_id.as_str(), expected.seed.as_str()));
                // Two pairings with the same seed (a variant and its incumbent) do not overwrite each other's files.
                assert!(replay.file.contains(&format!("batch{}{}", std::path::MAIN_SEPARATOR, i)), "{}", replay.file);
                assert!(std::path::Path::new(&replay.file).exists());
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn job_of_batch() -> BatchJob {
        BatchJob { pairings: vec![], players: vec!["r".into(), "r".into()], threads: 1, replay_dir: None, per_game: false }
    }

    #[test]
    fn optimize_plays_every_combination_with_the_same_seeds() {
        // Altaria without its two Rocky Helmets: fill the two slots with Rocky Helmet or Poké Ball.
        let base: String = crate::coach::tests::ALTARIA
            .lines()
            .filter(|line| !line.contains("Rocky Helmet"))
            .collect::<Vec<_>>()
            .join("\n");
        let run = |candidates: &[&str]| {
            let result = optimize(OptimizeJob {
                deck: base.clone(),
                candidates: candidates.iter().map(|id| id.to_string()).collect(),
                missing: 2,
                enemies: vec![crate::coach::tests::ALTARIA.to_string(), crate::coach::tests::ALTARIA.to_string()],
                games_per_enemy: 6,
                players: vec!["r".to_string(), "r".to_string()],
                seed: 20261009,
                threads: 2,
                max_combinations: 200,
            })
            .expect("optimize");
            result
                .combinations
                .into_iter()
                .map(|combination| {
                    let mut cards = combination.cards.clone();
                    cards.sort();
                    (cards, serde_json::to_string(&combination.per_enemy).unwrap())
                })
                .collect::<std::collections::BTreeMap<_, _>>()
        };
        // deckgym combines without repetition: a card listed twice can take both slots.
        let both = run(&["A2 148", "A2 148", "A2b 111"]);
        let reversed = run(&["A2b 111", "A2 148", "A2 148"]);
        let alone = run(&["A2 148", "A2 148"]);
        assert!(both.len() >= 2, "{both:?}");
        // A combination plays the same games whatever else is tried with it and wherever it falls in the job. (The
        // order of its own cards does matter: deckgym shuffles by position, so «+A +B» and «+B +A» are other decks.)
        let pair = vec!["A2 148".to_string(), "A2 148".to_string()];
        assert_eq!(alone.get(&pair), both.get(&pair));
        assert_eq!(alone.get(&pair), reversed.get(&pair));
        assert!(alone.get(&pair).is_some());
    }

    #[test]
    fn the_starter_is_who_plays_turn_one() {
        let deck = Deck::from_string(crate::coach::tests::ALTARIA).expect("deck");
        for seed in 0..12 {
            let players = create_players(deck.clone(), deck.clone(), vec![BotCode::Deckgym(PlayerCode::R), BotCode::Deckgym(PlayerCode::R)]);
            let mut game = Game::new(players, seed);
            let starter = game.get_state_clone().current_player;
            while game.get_state_clone().turn_count == 0 {
                game.play_tick();
            }
            assert_eq!(game.get_state_clone().current_player, starter, "seed {seed}");
        }
    }

    /// The result's JSON with its `durationMs` at 0: what must be the same byte for byte (the time never is).
    fn without_duration<T: Serialize>(result: &T) -> String {
        let mut value = serde_json::to_value(result).expect("json");
        if let Some(object) = value.as_object_mut() {
            object.insert("durationMs".to_string(), serde_json::json!(0));
        }
        serde_json::to_string(&value).expect("json")
    }

    /// Every file of a folder with its bytes, by name.
    fn files_of(dir: &std::path::Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| (entry.file_name().to_string_lossy().into_owned(), std::fs::read(entry.path()).expect("file")))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Keeps the first `keep` games of a checkpoint (in the order they finished) and a line cut in half, as the end of
    /// the process leaves it; the replays of the games it drops go too, as if they had never been written.
    fn cut(checkpoint: &std::path::Path, keep: usize, replays: Option<&std::path::Path>) {
        let text = std::fs::read_to_string(checkpoint).expect("checkpoint");
        let mut lines = text.lines();
        let header = lines.next().expect("header");
        let games: Vec<&str> = lines.collect();
        let mut out = format!("{header}\n");
        for line in &games[..keep] {
            out.push_str(line);
            out.push('\n');
        }
        if let Some(next) = games.get(keep) {
            out.push_str(&next[..next.len() / 2]);
            if let Some(dir) = replays {
                let index: u64 = next.split(' ').next().expect("index").parse().expect("index");
                let seed = 20261009;
                let _ = std::fs::remove_file(dir.join(format!("{}.json", game_id_for(seed, index))));
            }
        }
        for line in games.iter().skip(keep + 1) {
            if let Some(dir) = replays {
                let index: u64 = line.split(' ').next().expect("index").parse().expect("index");
                let _ = std::fs::remove_file(dir.join(format!("{}.json", game_id_for(20261009, index))));
            }
        }
        std::fs::write(checkpoint, out).expect("cut");
    }

    /// `resume` (H-054): cut at any game and played again, a pairing gives byte for byte the result of a run in one go
    /// (but for `durationMs`), and the same replays; a checkpoint of another job is not used.
    #[test]
    fn a_pairing_cut_anywhere_and_resumed_is_the_same_as_one_run() {
        let root = std::env::temp_dir().join(format!("engine-cli-resume-pairing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let replays = root.join("replays");
        let checkpoint = root.join("progress.txt");
        let games = 24;
        let base = || SimulateJob {
            replay_sample: 4,
            replay_dir: Some(replays.display().to_string()),
            threads: 3,
            ..job(games, true)
        };
        let once = simulate(base()).expect("simulate");
        let once_text = without_duration(&once);
        let once_replays = files_of(&replays);
        assert_eq!(once_replays.len(), 4);
        // With a checkpoint and nothing cut: the same.
        let full = simulate(SimulateJob { checkpoint: Some(checkpoint.display().to_string()), ..base() }).expect("simulate");
        assert_eq!(without_duration(&full), once_text);
        let lines = std::fs::read_to_string(&checkpoint).expect("checkpoint").lines().count();
        assert_eq!(lines, games as usize + 1, "a header and one line per game");
        // Cut at the start, near it, in the middle, at the last game and after all of them.
        for keep in [0, 1, 7, 13, 23, 24] {
            simulate(SimulateJob { checkpoint: Some(checkpoint.display().to_string()), ..base() }).expect("simulate");
            cut(&checkpoint, keep, Some(&replays));
            let resumed =
                simulate(SimulateJob { checkpoint: Some(checkpoint.display().to_string()), ..base() }).expect("simulate");
            assert_eq!(without_duration(&resumed), once_text, "cut after {keep} games");
            assert_eq!(files_of(&replays), once_replays, "replays after a cut after {keep} games");
            // Only the missing games were played: each index once, every one of them (review of `resume`).
            let mut indexes = checkpoint_indexes(&checkpoint);
            indexes.sort_unstable();
            assert_eq!(indexes, (0..games).collect::<Vec<_>>(), "the checkpoint after a cut after {keep} games");
        }
        // The time of the runs before counts in `durationMs`: nothing left to play, and an hour played already.
        let text = std::fs::read_to_string(&checkpoint).expect("checkpoint");
        let hour: String = text
            .lines()
            .enumerate()
            .map(|(i, line)| if i == 0 { format!("{line}\n") } else { format!("{} 3600000\n", &line[..line.rfind(' ').unwrap()]) })
            .collect();
        std::fs::write(&checkpoint, hour).expect("checkpoint");
        let resumed = simulate(SimulateJob { checkpoint: Some(checkpoint.display().to_string()), ..base() }).expect("simulate");
        assert!(resumed.duration_ms >= 3_600_000, "{}", resumed.duration_ms);
        assert_eq!(without_duration(&resumed), once_text);
        // A checkpoint of another job is never used: each field of its first line, one at a time. The job with the
        // checkpoint of the base job gives what it gives without one.
        let variants: Vec<(&str, Box<dyn Fn() -> SimulateJob + '_>)> = vec![
            ("seed", Box::new(|| SimulateJob { seed: 7, ..base() })),
            ("games", Box::new(|| SimulateJob { games: 20, ..base() })),
            ("replays", Box::new(|| SimulateJob { replay_sample: 1, ..base() })),
            ("perGame", Box::new(|| SimulateJob { per_game: false, ..base() })),
            ("deck A", Box::new(|| SimulateJob { deck_a: OTHER_DECK.to_string(), ..base() })),
            ("deck B", Box::new(|| SimulateJob { deck_b: OTHER_DECK.to_string(), ..base() })),
            ("players", Box::new(|| SimulateJob { players: vec!["r".to_string(), "e2".to_string()], ..base() })),
        ];
        for (field, variant) in variants {
            simulate(SimulateJob { checkpoint: Some(checkpoint.display().to_string()), ..base() }).expect("simulate");
            let with = simulate(SimulateJob { checkpoint: Some(checkpoint.display().to_string()), ..variant() })
                .expect("simulate");
            let fresh = simulate(variant()).expect("simulate");
            assert_eq!(without_duration(&with), without_duration(&fresh), "another {field}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Another deck for the tests of `resume` (the Venusaur of the browser's smoke).
    const OTHER_DECK: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64";

    /// The indexes a checkpoint has, one per line after its first.
    fn checkpoint_indexes(path: &std::path::Path) -> Vec<u32> {
        std::fs::read_to_string(path)
            .expect("checkpoint")
            .lines()
            .skip(1)
            .map(|line| line.split(' ').next().expect("index").parse().expect("index"))
            .collect()
    }

    /// Two pairings of a batch never share a checkpoint.
    #[test]
    fn a_batch_refuses_two_pairings_with_one_checkpoint() {
        let altaria = crate::coach::tests::ALTARIA.to_string();
        let pairing = |seed: u64| BatchPairing {
            deck_a: altaria.clone(),
            deck_b: altaria.clone(),
            games: 2,
            seed,
            replay_sample: 0,
            checkpoint: Some("progress.txt".to_string()),
        };
        let error = batch(BatchJob {
            pairings: vec![pairing(1), pairing(2)],
            players: vec!["r".to_string(), "r".to_string()],
            threads: 1,
            replay_dir: None,
            per_game: false,
        })
        .err()
        .expect("refused");
        assert!(error.error.contains("compartir"), "{}", error.error);
    }

    #[test]
    fn a_batch_resumes_each_pairing_from_its_own_checkpoint() {
        let root = std::env::temp_dir().join(format!("engine-cli-resume-batch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("dir");
        let altaria = crate::coach::tests::ALTARIA.to_string();
        let job = |checkpoints: bool| BatchJob {
            pairings: [(9u32, 20261009u64), (7, 20261010)]
                .iter()
                .enumerate()
                .map(|(i, &(games, seed))| BatchPairing {
                    deck_a: altaria.clone(),
                    deck_b: altaria.clone(),
                    games,
                    seed,
                    replay_sample: 0,
                    checkpoint: checkpoints.then(|| root.join(format!("progress-{i}.txt")).display().to_string()),
                })
                .collect(),
            players: vec!["r".to_string(), "r".to_string()],
            threads: 3,
            replay_dir: None,
            per_game: true,
        };
        let once = without_duration(&batch(job(false)).expect("batch"));
        batch(job(true)).expect("batch");
        cut(&root.join("progress-0.txt"), 4, None);
        cut(&root.join("progress-1.txt"), 0, None);
        assert_eq!(without_duration(&batch(job(true)).expect("batch")), once);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_game_line_says_what_the_result_says_of_the_game() {
        for run in [
            GameRun { winner: Winner::A, turns: 14, starter: 0, ending: Ending::Points, stages: [2, 1] },
            GameRun { winner: Winner::Tie, turns: 31, starter: 1, ending: Ending::TurnLimit, stages: [0, 0] },
            GameRun { winner: Winner::B, turns: 9, starter: 1, ending: Ending::NoPokemon, stages: [1, 2] },
        ] {
            let line = game_line(&run);
            let back = game_of_line(&line).expect("line");
            assert_eq!(game_line(&back), line);
        }
        assert_eq!(game_line(&GameRun { winner: Winner::A, turns: 14, starter: 0, ending: Ending::Points, stages: [2, 1] }), "A0P 14 21");
        for bad in ["", "A0P 14", "X0P 14 21", "A2P 14 21", "A0P x 21", "A0P 14 2", "A0P 14 21 9", "A0PP 14 21"] {
            assert!(game_of_line(bad).is_none(), "{bad:?}");
        }
    }

}

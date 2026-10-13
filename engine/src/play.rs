//! `engine-cli play <job.json>`: one game of the owner against a bot (PLAN §3.7, Fase 8), one decision at a time.
//!
//! The owner sits in seat 0 with `deckHuman`; the bot plays `deckBot` in seat 1. Everything that happens goes to
//! stdout as JSON lines, and the owner's choices come back on stdin, one per line (`{"i": 3}` or just `3`). There is
//! no timeout: the engine waits as long as the owner thinks (the worker relays it to the app).
//!
//! stdout lines:
//!   {"type":"start","engineRev","seed","you":0,"bot"}
//!   {"type":"action","ply","turn","actor","text","action","ctx"}   every action of either player, in order
//!   {"type":"decide","ply","turn","state","actions":[{"i","text","action"}],"coach"?:{"scores","best"}}
//!                                                                   the owner chooses (2+ options); with the coach
//!                                                                   (Fase 20), the value of each option first
//!   {"type":"invalid","ply","message"}                              a choice out of range: `decide` comes again
//!   {"type":"end","winner":"you"|"bot"|"tie","turns","state","replay"}
//! `ply` numbers the owner's decisions (1, 2…); a forced move (one option) is taken without asking. The game is fully
//! determined by its seed and the owner's choices, so the worker can rebuild it after a restart by sending the same
//! choices again.

use std::io::{BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use deckgym::actions::Action;
use deckgym::replay::{ReplayRecorder, ViewState};
use deckgym::simulation_event_handler::{CompositeSimulationEventHandler, GameStartMetadata, SimulationEventHandler};
use deckgym::state::GameOutcome;
use deckgym::{Deck, State};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::fair_bot::BotCode;
use crate::live::{action_line, live_game_id, winner_of, LiveGame, Step, HUMAN};
use crate::{require_simulable, CliError, ENGINE_REV};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayJob {
    deck_human: String,
    deck_bot: String,
    /// Bot code: «e2», «r»… (not «h» nor «x»).
    bot: String,
    seed: u64,
    /// Where the replay of the finished game is written (`<game_id>.json`).
    #[serde(default)]
    replay_dir: Option<String>,
    /// Modo entrenador (Fase 20): score every option of each decision before asking.
    #[serde(default)]
    coach: bool,
}

fn emit(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

/// How the owner's seat gets an answer: the `decide` message (its options numbered as `i`) and how many there are, to
/// the index chosen. The CLI asks over stdout and reads stdin (`ask_over_stdio`); the golden games (games_rev_tests)
/// answer from a fixed list, through the same seat and numbering.
pub(crate) type Ask = Box<dyn FnMut(&Value, usize) -> usize + Send>;

/// `{"i": 3}`, `3` or `"3"`.
fn parse_choice(line: &str) -> Option<usize> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    match value {
        Value::Number(n) => n.as_u64().map(|n| n as usize),
        Value::String(s) => s.trim().parse().ok(),
        Value::Object(map) => map.get("i").and_then(Value::as_u64).map(|n| n as usize),
        _ => None,
    }
}

/// The CLI's answers: `decide` on stdout, the choice from stdin; an answer out of range asks again.
fn ask_over_stdio(decide: &Value, options: usize) -> usize {
    emit(decide);
    let stdin = std::io::stdin();
    loop {
        let mut line = String::new();
        match stdin.lock().read_line(&mut line) {
            // The worker went away: nobody will answer.
            Ok(0) | Err(_) => std::process::exit(4),
            Ok(_) => {}
        }
        match parse_choice(&line) {
            Some(i) if i < options => return i,
            _ => {
                emit(&json!({
                    "type": "invalid",
                    "ply": decide["ply"],
                    "message": format!("elegí un número de 0 a {}", options - 1),
                }));
                emit(decide);
            }
        }
    }
}

/// One game of the owner against the bot, as `engine-cli play` plays it (live.rs, the browser's rules too), with
/// `handlers` told of everything (the end too) and `ask` answering each decision. The final state comes back.
#[allow(clippy::too_many_arguments)]
pub(crate) fn run_live_game(
    deck_human: &Deck,
    deck_bot: &Deck,
    code: BotCode,
    bot_label: &str,
    seed: u64,
    coach: bool,
    mut ask: Ask,
    handlers: Vec<Box<dyn SimulationEventHandler>>,
) -> (Option<GameOutcome>, State) {
    let game_id = live_game_id(seed);
    let mut handler = CompositeSimulationEventHandler::new(handlers);
    let player_names = ["Santi".to_string(), format!("bot {bot_label}")];
    let metadata = GameStartMetadata { seed, player_names, decks: [deck_human, deck_bot] };
    handler.on_game_start_with_metadata(game_id, &metadata);
    let state = {
        let mut game = LiveGame::new(deck_human, deck_bot, code, seed, coach, Some(&mut handler));
        loop {
            match game.step() {
                Step::Ended => break,
                Step::Played { .. } => {}
                Step::Decide => {
                    // With the coach (Fase 20), the value of each option first.
                    game.coach();
                    let decide = game.decide_message().expect("a pending decision");
                    let options = game.pending().map_or(0, |pending| pending.actions.len());
                    let i = ask(&decide, options);
                    game.answer(i).expect("an answer in range");
                }
            }
        }
        game.state()
    };
    let outcome = state.winner;
    handler.on_game_end(game_id, state.clone(), outcome);
    (outcome, state)
}

/// Reports every action of the game as it happens.
struct ActionLog {
    owner_plies: u32,
}

impl SimulationEventHandler for ActionLog {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(
        &mut self,
        _game_id: Uuid,
        state_before_action: &State,
        actor: usize,
        playable_actions: &[Action],
        action: &Action,
    ) {
        if actor == HUMAN && playable_actions.len() > 1 {
            self.owner_plies += 1;
        }
        let mut line = action_line(self.owner_plies, state_before_action, actor, playable_actions, action);
        line["type"] = json!("action");
        emit(&line);
    }
}

fn bot_code(code: &str) -> Result<BotCode, CliError> {
    crate::live::bot_code(code).map_err(CliError::input)
}

pub fn play(job: PlayJob) -> Result<(), CliError> {
    let deck_human = require_simulable("tuyo", &job.deck_human)?;
    let deck_bot = require_simulable("del bot", &job.deck_bot)?;
    let code = bot_code(&job.bot)?;
    let replay_dir = job.replay_dir.as_ref().map(PathBuf::from);
    if let Some(dir) = &replay_dir {
        std::fs::create_dir_all(dir).map_err(|e| CliError::engine(format!("no se pudo crear {}: {e}", dir.display())))?;
    }
    let game_id = live_game_id(job.seed);
    emit(&json!({
        "type": "start",
        "engineRev": ENGINE_REV,
        "seed": job.seed.to_string(),
        "you": HUMAN,
        "bot": job.bot,
        "coach": job.coach,
        "gameId": game_id.to_string(),
    }));
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let mut handlers: Vec<Box<dyn SimulationEventHandler>> = vec![Box::new(ActionLog { owner_plies: 0 })];
        if let Some(dir) = &replay_dir {
            handlers.push(Box::new(ReplayRecorder::new(dir.clone(), Arc::new(AtomicUsize::new(0)), None)));
        }
        let (outcome, state) = run_live_game(
            &deck_human,
            &deck_bot,
            code.clone(),
            &job.bot,
            job.seed,
            job.coach,
            Box::new(ask_over_stdio),
            handlers,
        );
        let view = ViewState::for_player(&state, HUMAN);
        (outcome, state.turn_count, view)
    }))
    .map_err(|panic| {
        let message = panic
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "el motor falló".to_string());
        CliError::engine(format!("la partida falló: {message}"))
    })?;
    let (result, turns, view) = outcome;
    let winner = winner_of(result);
    emit(&json!({
        "type": "end",
        "winner": winner,
        "turns": turns,
        "state": view,
        "replay": replay_dir.map(|dir| dir.join(format!("{game_id}.json")).display().to_string()),
    }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_are_read_in_any_simple_shape() {
        assert_eq!(parse_choice("{\"i\": 3}\n"), Some(3));
        assert_eq!(parse_choice("2"), Some(2));
        assert_eq!(parse_choice("\"1\""), Some(1));
        assert_eq!(parse_choice("nope"), None);
        assert_eq!(parse_choice("{\"x\": 1}"), None);
    }
}

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
use deckgym::players::{create_players, parse_player_code, Player, PlayerCode};
use deckgym::replay::{ReplayRecorder, ViewState};
use deckgym::simulation_event_handler::{CompositeSimulationEventHandler, GameStartMetadata, SimulationEventHandler};
use deckgym::state::GameOutcome;
use deckgym::{Deck, Game, State};
use rand::rngs::StdRng;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::coach::{best_option, coach_scores, COACH_SAMPLES};
use crate::{game_seed, require_simulable, CliError, ENGINE_REV};

/// The owner's seat.
const HUMAN: usize = 0;

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

/// What the coach needs: both decks and its own seed (never the game's).
struct CoachSetup {
    decks: [Deck; 2],
    seed: u64,
}

fn emit(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

/// Card ids in play for both players and the stadium: what a client needs to name the targets of an action.
fn context(state: &State) -> Value {
    let view = ViewState::for_player(state, HUMAN);
    let in_play: Vec<Vec<Option<String>>> = view
        .players
        .iter()
        .map(|player| player.in_play.iter().map(|slot| slot.as_ref().map(|s| s.card.clone())).collect())
        .collect();
    json!({ "in_play": in_play, "stadium": view.stadium })
}

/// The owner's seat: asks over stdout, reads the answer from stdin, waits without limit.
struct RemoteHuman {
    deck: Deck,
    ply: u32,
    coach: Option<CoachSetup>,
    /// The coach's values for the last decision: the replay records them next to it.
    last_scores: Option<Vec<f64>>,
}

impl std::fmt::Debug for RemoteHuman {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Santi")
    }
}

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

impl Player for RemoteHuman {
    fn get_deck(&self) -> Deck {
        self.deck.clone()
    }

    fn last_scores(&self) -> Option<Vec<f64>> {
        self.last_scores.clone()
    }

    fn decision_fn(&mut self, _rng: &mut StdRng, state: &State, possible_actions: &[Action]) -> Action {
        if possible_actions.len() == 1 {
            return possible_actions[0].clone();
        }
        self.ply += 1;
        let actor = possible_actions[0].actor;
        let actions: Vec<Value> = possible_actions
            .iter()
            .enumerate()
            .map(|(i, a)| json!({ "i": i, "text": a.action.to_string(), "action": a.action }))
            .collect();
        let mut decide = json!({
            "type": "decide",
            "ply": self.ply,
            "turn": state.turn_count,
            "state": ViewState::for_player(state, actor),
            "actions": actions,
        });
        self.last_scores = None;
        if let Some(coach) = &self.coach {
            let scores = coach_scores(
                state,
                possible_actions,
                &coach.decks,
                game_seed(coach.seed, u64::from(self.ply)),
                COACH_SAMPLES,
            );
            let rounded: Vec<f64> = scores.iter().map(|score| (score * 10.0).round() / 10.0).collect();
            decide["coach"] = json!({ "scores": rounded, "best": best_option(&scores) });
            self.last_scores = Some(scores);
        }
        emit(&decide);
        let stdin = std::io::stdin();
        loop {
            let mut line = String::new();
            match stdin.lock().read_line(&mut line) {
                // The worker went away: nobody will answer.
                Ok(0) | Err(_) => std::process::exit(4),
                Ok(_) => {}
            }
            match parse_choice(&line) {
                Some(i) if i < possible_actions.len() => return possible_actions[i].clone(),
                _ => {
                    emit(&json!({
                        "type": "invalid",
                        "ply": self.ply,
                        "message": format!("elegí un número de 0 a {}", possible_actions.len() - 1),
                    }));
                    emit(&decide);
                }
            }
        }
    }
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
        emit(&json!({
            "type": "action",
            "ply": self.owner_plies,
            "turn": state_before_action.turn_count,
            "actor": actor,
            "forced": playable_actions.len() == 1,
            "text": action.action.to_string(),
            "action": action.action,
            "ctx": context(state_before_action),
        }));
    }
}

fn bot_code(code: &str) -> Result<PlayerCode, CliError> {
    match parse_player_code(code).map_err(CliError::input)? {
        PlayerCode::H | PlayerCode::X => Err(CliError::input(format!("«{code}» no sirve como rival"))),
        other => Ok(other),
    }
}

pub fn play(job: PlayJob) -> Result<(), CliError> {
    let deck_human = require_simulable("tuyo", &job.deck_human)?;
    let deck_bot = require_simulable("del bot", &job.deck_bot)?;
    let code = bot_code(&job.bot)?;
    let replay_dir = job.replay_dir.as_ref().map(PathBuf::from);
    if let Some(dir) = &replay_dir {
        std::fs::create_dir_all(dir).map_err(|e| CliError::engine(format!("no se pudo crear {}: {e}", dir.display())))?;
    }
    let game_id = Uuid::from_u64_pair(job.seed, 0x504c_4159); // «PLAY»
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
        let mut handler = CompositeSimulationEventHandler::new(handlers);
        let bot = create_players(deck_human.clone(), deck_bot.clone(), vec![code.clone(), code.clone()])
            .pop()
            .expect("two players");
        let coach = job.coach.then(|| CoachSetup {
            decks: [deck_human.clone(), deck_bot.clone()],
            seed: job.seed ^ 0xC0AC_4000_0000_0000,
        });
        let human = RemoteHuman { deck: deck_human.clone(), ply: 0, coach, last_scores: None };
        let players: Vec<Box<dyn Player>> = vec![Box::new(human), bot];
        let player_names = ["Santi".to_string(), format!("bot {}", job.bot)];
        let decks = [players[0].get_deck(), players[1].get_deck()];
        let metadata = GameStartMetadata { seed: job.seed, player_names, decks: [&decks[0], &decks[1]] };
        handler.on_game_start_with_metadata(game_id, &metadata);
        let (outcome, state) = {
            let mut game = Game::new_with_event_handlers(game_id, players, job.seed, &mut handler);
            let outcome = game.play();
            (outcome, game.get_state_clone())
        };
        let view = ViewState::for_player(&state, HUMAN);
        let turns = state.turn_count;
        handler.on_game_end(game_id, state, outcome);
        (outcome, turns, view)
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
    let winner = match result {
        Some(GameOutcome::Win(p)) if p == HUMAN => "you",
        Some(GameOutcome::Win(_)) => "bot",
        Some(GameOutcome::Tie) | None => "tie",
    };
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

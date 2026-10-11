//! One game of the owner against a bot, one decision at a time: what `engine-cli play` (engine/src/play.rs) does over
//! stdin and stdout, as calls the browser makes (T-015). A browser cannot block waiting for the owner, so the game
//! stops at each of the owner's decisions and goes on when `advance` brings the choice.
//!
//! The same rules as `play`: the owner sits in seat 0, a forced move (one option) is taken without asking, `ply`
//! numbers the owner's decisions (1, 2…), the actions and the replay have the same shape, and the coach scores each
//! option with its own seeds (never the game's). The game is fully determined by its seed and the owner's choices, so
//! a page rebuilds it by sending the same choices again. Not the same game as on a PC with the same seed (R-003:
//! deckgym draws `usize` numbers, 32 bits here), so a game started in the browser ends in a browser.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::rc::Rc;

use deckgym::actions::Action;
use deckgym::card_ids::CardId;
use deckgym::card_validation::get_implementation_status;
use deckgym::models::Card;
use deckgym::players::{Player, PlayerCode};
use deckgym::replay::{Replay, ReplayOption, ReplayPlayerInfo, ReplayStep, ViewState, REPLAY_FORMAT_VERSION};
use deckgym::state::GameOutcome;
use deckgym::{Deck, Game, State};
use rand::rngs::StdRng;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::coach::{best_option, coach_scores, COACH_SAMPLES};
use crate::fair_bot::{create_players, parse_bot_code, BotCode};
use crate::seeds::game_seed;
use crate::ENGINE_REV;

/// The owner's seat.
const HUMAN: usize = 0;

/// What the app sends to start a game (the same fields as engine-cli's play job, without the replay folder).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayJob {
    pub deck_human: String,
    pub deck_bot: String,
    /// Bot code: «e2», «f2», «r»… (not «h» nor «x»).
    pub bot: String,
    /// In decimal: a u64 does not always fit in a JavaScript number.
    pub seed: String,
    /// Modo entrenador (Fase 20).
    #[serde(default)]
    pub coach: bool,
}

/// The owner's seat: plays the option `advance` was given.
struct Owner {
    deck: Deck,
    answer: Rc<Cell<Option<usize>>>,
}

impl std::fmt::Debug for Owner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Santi")
    }
}

impl Player for Owner {
    fn get_deck(&self) -> Deck {
        self.deck.clone()
    }

    fn decision_fn(&mut self, _rng: &mut StdRng, _state: &State, possible_actions: &[Action]) -> Action {
        let i = self.answer.take().expect("the stepper sets the owner's answer before the owner's move");
        possible_actions[i].clone()
    }
}

/// The owner's decision the game is stopped at.
struct Pending {
    ply: u32,
    state: State,
    actions: Vec<Action>,
    /// The coach's values (full precision, as the replay records them), once computed or restored.
    scores: Option<Vec<f64>>,
}

pub struct Stepper {
    game: Game<'static>,
    answer: Rc<Cell<Option<usize>>>,
    seed: u64,
    bot: String,
    game_id: Uuid,
    /// Modo entrenador: both decks and the coach's own seed.
    coach: Option<([Deck; 2], u64)>,
    /// The owner's decisions so far (the last one may be pending).
    ply: u32,
    pending: Option<Pending>,
    replay: Replay,
    /// The `end` message, once the game ended.
    ended: Option<Value>,
}

/// Parsed, valid for deckgym and with every card implemented: what engine-cli's `require_simulable` asks.
fn playable(label: &str, text: &str) -> Result<Deck, String> {
    let deck = Deck::from_string(text).map_err(|e| format!("el mazo {label} no se puede jugar: {e}"))?;
    if !deck.is_valid() {
        return Err(format!(
            "el mazo {label} no se puede jugar: 20 cartas, un Básico, energías elegibles y 2 por nombre"
        ));
    }
    let mut missing: Vec<String> = Vec::new();
    for card in &deck.cards {
        let id = card.get_id();
        let incomplete = CardId::from_card_id(&id).is_some_and(|card_id| !get_implementation_status(card_id).is_complete());
        if incomplete && !missing.contains(&id) {
            missing.push(id);
        }
    }
    if !missing.is_empty() {
        return Err(format!("el mazo {label} tiene cartas que el motor no implementa: {}", missing.join(", ")));
    }
    Ok(deck)
}

fn bot_code(code: &str) -> Result<BotCode, String> {
    match parse_bot_code(code)? {
        BotCode::Deckgym(PlayerCode::H | PlayerCode::X) => Err(format!("«{code}» no sirve como rival")),
        other => Ok(other),
    }
}

/// Card ids in play for both players and the stadium (play.rs's `context`).
fn context(state: &State) -> Value {
    let view = ViewState::for_player(state, HUMAN);
    let in_play: Vec<Vec<Option<String>>> = view
        .players
        .iter()
        .map(|player| player.in_play.iter().map(|slot| slot.as_ref().map(|s| s.card.clone())).collect())
        .collect();
    json!({ "in_play": in_play, "stadium": view.stadium })
}

impl Stepper {
    pub fn new(job: PlayJob) -> Result<Stepper, String> {
        let seed: u64 = job.seed.trim().parse().map_err(|_| format!("semilla inválida: «{}»", job.seed))?;
        let deck_human = playable("tuyo", &job.deck_human)?;
        let deck_bot = playable("del bot", &job.deck_bot)?;
        let code = bot_code(&job.bot)?;
        let answer = Rc::new(Cell::new(None));
        let bot = create_players(deck_human.clone(), deck_bot.clone(), vec![code.clone(), code])
            .pop()
            .expect("two players");
        let owner = Owner { deck: deck_human.clone(), answer: answer.clone() };
        let players: Vec<Box<dyn Player>> = vec![Box::new(owner), bot];
        let decks = [players[0].get_deck(), players[1].get_deck()];
        let game_id = Uuid::from_u64_pair(seed, 0x504c_4159); // «PLAY», like engine-cli
        // deckgym's ReplayRecorder writes files; the browser keeps the same replay in memory.
        let mut cards: BTreeMap<String, Card> = BTreeMap::new();
        for deck in &decks {
            for card in &deck.cards {
                cards.entry(card.get_id()).or_insert_with(|| card.clone());
            }
        }
        let names = ["Santi".to_string(), format!("bot {}", job.bot)];
        let replay = Replay {
            version: REPLAY_FORMAT_VERSION,
            game_id: game_id.to_string(),
            seed,
            players: std::array::from_fn(|i| ReplayPlayerInfo {
                name: names[i].clone(),
                deck: decks[i].cards.iter().map(Card::get_id).collect(),
            }),
            cards,
            steps: Vec::new(),
            final_state: None,
            outcome: None,
        };
        let coach = job.coach.then(|| ([deck_human, deck_bot], seed ^ 0xC0AC_4000_0000_0000));
        Ok(Stepper {
            game: Game::new(players, seed),
            answer,
            seed,
            bot: job.bot,
            game_id,
            coach,
            ply: 0,
            pending: None,
            replay,
            ended: None,
        })
    }

    /// play.rs's `start` line.
    pub fn info(&self) -> Value {
        json!({
            "type": "start",
            "engineRev": ENGINE_REV,
            "seed": self.seed.to_string(),
            "you": HUMAN,
            "bot": self.bot,
            "coach": self.coach.is_some(),
            "gameId": self.game_id.to_string(),
        })
    }

    /// Plays on to the owner's next decision or to the end; `choice` answers the decision returned last. Returns
    /// `{"type":"decide","ply","turn","state","actions","log"}` or `{"type":"end","winner","turns","state","log"}`,
    /// with the actions played since the last call in `log` (play.rs's `action` lines, without `type`).
    pub fn advance(&mut self, choice: Option<usize>) -> Result<Value, String> {
        if let Some(end) = &self.ended {
            if choice.is_some() {
                return Err("la partida ya terminó".to_string());
            }
            let mut end = end.clone();
            end["log"] = json!([]);
            return Ok(end);
        }
        let mut log = Vec::new();
        match (self.pending.take(), choice) {
            (Some(pending), Some(i)) => {
                if i >= pending.actions.len() {
                    let message = format!("elegí un número de 0 a {}", pending.actions.len() - 1);
                    self.pending = Some(pending);
                    return Err(message);
                }
                self.answer.set(Some(i));
                let action = self.game.play_tick();
                self.record(&pending.state, HUMAN, &pending.actions, &action, pending.scores, &mut log);
            }
            (Some(pending), None) => {
                self.pending = Some(pending);
                return Ok(self.decide(log));
            }
            (None, Some(_)) => return Err("no hay ninguna decisión pendiente".to_string()),
            (None, None) => {}
        }
        loop {
            if self.game.is_game_over() {
                return Ok(self.finish(log));
            }
            let state = self.game.get_state_clone();
            let (actor, actions) = state.generate_possible_actions();
            if actor == HUMAN && actions.len() > 1 {
                self.ply += 1;
                self.pending = Some(Pending { ply: self.ply, state, actions, scores: None });
                return Ok(self.decide(log));
            }
            let action = self.game.play_tick();
            self.record(&state, actor, &actions, &action, None, &mut log);
        }
    }

    /// Modo entrenador: the value of each option of the pending decision, `{"scores","best","values"}` (`scores`
    /// rounded like play.rs's, `values` at full precision to keep for a rebuild).
    pub fn coach(&mut self) -> Result<Value, String> {
        let Some((decks, seed)) = &self.coach else {
            return Err("esta partida no tiene el modo entrenador".to_string());
        };
        let pending = self.pending.as_mut().ok_or("no hay ninguna decisión pendiente")?;
        let scores = pending.scores.get_or_insert_with(|| {
            coach_scores(&pending.state, &pending.actions, decks, game_seed(*seed, u64::from(pending.ply)), COACH_SAMPLES)
        });
        let rounded: Vec<f64> = scores.iter().map(|score| (score * 10.0).round() / 10.0).collect();
        Ok(json!({ "scores": rounded, "best": best_option(scores), "values": scores }))
    }

    /// The coach's values of the pending decision computed before a rebuild (`values` of `coach`), so the replay
    /// keeps them without scoring again.
    pub fn restore_coach(&mut self, values: Vec<f64>) -> Result<(), String> {
        if self.coach.is_none() {
            return Err("esta partida no tiene el modo entrenador".to_string());
        }
        let pending = self.pending.as_mut().ok_or("no hay ninguna decisión pendiente")?;
        if values.len() != pending.actions.len() || values.iter().any(|value| !value.is_finite()) {
            return Err("esos valores no son de esta decisión".to_string());
        }
        pending.scores = Some(values);
        Ok(())
    }

    /// The replay of the finished game (deckgym's format, like the file engine-cli writes); `None` before the end.
    pub fn replay(&self) -> Option<String> {
        self.ended.as_ref()?;
        serde_json::to_string(&self.replay).ok()
    }

    fn decide(&self, log: Vec<Value>) -> Value {
        let pending = self.pending.as_ref().expect("a pending decision");
        let actions: Vec<Value> = pending
            .actions
            .iter()
            .enumerate()
            .map(|(i, a)| json!({ "i": i, "text": a.action.to_string(), "action": a.action }))
            .collect();
        json!({
            "type": "decide",
            "ply": pending.ply,
            "turn": pending.state.turn_count,
            "state": ViewState::for_player(&pending.state, HUMAN),
            "actions": actions,
            "log": log,
        })
    }

    /// play.rs's `action` line and the replay's step (deckgym's ReplayRecorder), for one action.
    fn record(
        &mut self,
        before: &State,
        actor: usize,
        actions: &[Action],
        action: &Action,
        scores: Option<Vec<f64>>,
        log: &mut Vec<Value>,
    ) {
        log.push(json!({
            "ply": self.ply,
            "turn": before.turn_count,
            "actor": actor,
            "forced": actions.len() == 1,
            "text": action.action.to_string(),
            "action": action.action,
            "ctx": context(before),
        }));
        self.replay.steps.push(ReplayStep {
            ply: self.replay.steps.len() as u32,
            turn: before.turn_count,
            actor,
            state: ViewState::omniscient(before),
            options: actions
                .iter()
                .map(|a| ReplayOption { text: a.action.to_string(), action: a.action.clone() })
                .collect(),
            chosen: actions.iter().position(|a| a == action).unwrap_or(0),
            note: None,
            scores: if actions.len() == 1 { None } else { scores },
        });
    }

    fn finish(&mut self, log: Vec<Value>) -> Value {
        let state = self.game.get_state_clone();
        let outcome = state.winner;
        let winner = match outcome {
            Some(GameOutcome::Win(p)) if p == HUMAN => "you",
            Some(GameOutcome::Win(_)) => "bot",
            Some(GameOutcome::Tie) | None => "tie",
        };
        self.replay.final_state = Some(ViewState::omniscient(&state));
        self.replay.outcome = outcome;
        let end = json!({
            "type": "end",
            "winner": winner,
            "turns": state.turn_count,
            "state": ViewState::for_player(&state, HUMAN),
        });
        self.ended = Some(end.clone());
        let mut end = end;
        end["log"] = Value::Array(log);
        end
    }
}

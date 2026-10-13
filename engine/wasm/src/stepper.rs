//! One game of the owner against a bot in the browser (T-015), one call at a time. The game itself is engine-cli's
//! (engine/src/live.rs, compiled here unchanged): the same seat, numbering, coach and messages as `engine-cli play`.
//! A browser cannot block waiting for the owner, so `advance` plays on to the owner's next decision and returns, and
//! the next call brings the choice. What is only the browser's: the replay kept in memory (engine-cli writes it to a
//! file with deckgym's recorder) and the actions played since the last call in `log`.
//!
//! The game is fully determined by its seed and the owner's choices, so a page rebuilds it by sending the same choices
//! again. Not the same game as on a PC with the same seed (R-003: deckgym draws `usize` numbers, 32 bits here), so a
//! game started in the browser ends in a browser.

use std::collections::BTreeMap;

use deckgym::actions::Action;
use deckgym::card_ids::CardId;
use deckgym::card_validation::get_implementation_status;
use deckgym::models::Card;
use deckgym::replay::{Replay, ReplayOption, ReplayPlayerInfo, ReplayStep, ViewState, REPLAY_FORMAT_VERSION};
use deckgym::{Deck, State};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::live::{action_line, bot_code, coach_view, live_game_id, winner_of, LiveGame, Step, HUMAN};
use crate::ENGINE_REV;

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

pub struct Stepper {
    game: LiveGame<'static>,
    seed: u64,
    bot: String,
    game_id: Uuid,
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

impl Stepper {
    pub fn new(job: PlayJob) -> Result<Stepper, String> {
        let seed: u64 = job.seed.trim().parse().map_err(|_| format!("semilla inválida: «{}»", job.seed))?;
        let deck_human = playable("tuyo", &job.deck_human)?;
        let deck_bot = playable("del bot", &job.deck_bot)?;
        let code = bot_code(&job.bot)?;
        let game_id = live_game_id(seed);
        // deckgym's ReplayRecorder writes files; the browser keeps the same replay in memory.
        let decks = [&deck_human, &deck_bot];
        let mut cards: BTreeMap<String, Card> = BTreeMap::new();
        for deck in decks {
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
        let game = LiveGame::new(&deck_human, &deck_bot, code, seed, job.coach, None);
        Ok(Stepper { game, seed, bot: job.bot, game_id, replay, ended: None })
    }

    /// play.rs's `start` line.
    pub fn info(&self) -> Value {
        json!({
            "type": "start",
            "engineRev": ENGINE_REV,
            "seed": self.seed.to_string(),
            "you": HUMAN,
            "bot": self.bot,
            "coach": self.game.has_coach(),
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
        if let Some(i) = choice {
            let (decision, action) = self.game.answer(i)?;
            self.record(&decision.state, HUMAN, &decision.actions, &action, decision.scores, &mut log);
        }
        loop {
            match self.game.step() {
                Step::Ended => return Ok(self.finish(log)),
                Step::Decide => return Ok(self.decide(log)),
                Step::Played { before, actor, playable, action } => {
                    self.record(&before, actor, &playable, &action, None, &mut log);
                }
            }
        }
    }

    /// Modo entrenador: the value of each option of the pending decision, `{"scores","best","values"}` (`scores`
    /// rounded like play.rs's, `values` at full precision to keep for a rebuild).
    pub fn coach(&mut self) -> Result<Value, String> {
        if !self.game.has_coach() {
            return Err("esta partida no tiene el modo entrenador".to_string());
        }
        let scores = self.game.coach().ok_or("no hay ninguna decisión pendiente")?.to_vec();
        let mut view = coach_view(&scores);
        view["values"] = json!(scores);
        Ok(view)
    }

    /// The coach's values of the pending decision computed before a rebuild (`values` of `coach`), so the replay
    /// keeps them without scoring again.
    pub fn restore_coach(&mut self, values: Vec<f64>) -> Result<(), String> {
        self.game.restore_coach(values)
    }

    /// The replay of the finished game (deckgym's format, like the file engine-cli writes); `None` before the end.
    pub fn replay(&self) -> Option<String> {
        self.ended.as_ref()?;
        serde_json::to_string(&self.replay).ok()
    }

    fn decide(&self, log: Vec<Value>) -> Value {
        let mut decide = self.game.decide_message().expect("a pending decision");
        // The page asks the coach apart (`coach`), so the decision comes without it.
        if let Some(object) = decide.as_object_mut() {
            object.remove("coach");
        }
        decide["log"] = Value::Array(log);
        decide
    }

    /// play.rs's `action` line and the replay's step (deckgym's ReplayRecorder), for one action.
    fn record(
        &mut self,
        before: &State,
        actor: usize,
        playable: &[Action],
        action: &Action,
        scores: Option<Vec<f64>>,
        log: &mut Vec<Value>,
    ) {
        log.push(action_line(self.game.ply(), before, actor, playable, action));
        self.replay.steps.push(ReplayStep {
            ply: self.replay.steps.len() as u32,
            turn: before.turn_count,
            actor,
            state: ViewState::omniscient(before),
            options: playable
                .iter()
                .map(|a| ReplayOption { text: a.action.to_string(), action: a.action.clone() })
                .collect(),
            chosen: playable.iter().position(|a| a == action).unwrap_or(0),
            note: None,
            scores: if playable.len() == 1 { None } else { scores },
        });
    }

    fn finish(&mut self, log: Vec<Value>) -> Value {
        let state = self.game.state();
        let outcome = state.winner;
        self.replay.final_state = Some(ViewState::omniscient(&state));
        self.replay.outcome = outcome;
        let end = json!({
            "type": "end",
            "winner": winner_of(outcome),
            "turns": state.turn_count,
            "state": ViewState::for_player(&state, HUMAN),
        });
        self.ended = Some(end.clone());
        let mut end = end;
        end["log"] = Value::Array(log);
        end
    }
}

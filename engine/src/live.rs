//! One game of the owner against a bot, one step at a time: what `engine-cli play` (play.rs) runs over stdin and
//! stdout, and what the browser's engine (engine/wasm, T-015) runs one call at a time. The rules of such a game live
//! here once, for both:
//! - the owner sits in seat 0 with `deck_human`, the bot plays `deck_bot` in seat 1;
//! - the game id and the coach's seed come from the game's seed;
//! - `ply` numbers the owner's decisions with more than one option, and a forced move is taken without asking;
//! - the `decide` and `action` messages have one shape.
//!
//! The game is fully determined by its seed and the owner's choices. The browser's games are not the same as a PC's
//! for the same seed (R-003: deckgym draws `usize` numbers, 32 bits in WebAssembly), so a game ends where it started.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use deckgym::actions::Action;
use deckgym::players::{Player, PlayerCode};
use deckgym::replay::ViewState;
use deckgym::simulation_event_handler::CompositeSimulationEventHandler;
use deckgym::state::GameOutcome;
use deckgym::{Deck, Game, State};
use rand::rngs::StdRng;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::coach::{best_option, coach_scores, COACH_SAMPLES};
use crate::fair_bot::{create_players, parse_bot_code, BotCode};
use crate::seeds::game_seed;

/// The owner's seat.
pub(crate) const HUMAN: usize = 0;

/// A game's id from its seed: the replay of the same game is always the same.
pub(crate) fn live_game_id(seed: u64) -> Uuid {
    Uuid::from_u64_pair(seed, 0x504c_4159) // «PLAY»
}

/// The coach's own seed (Fase 20): never the game's.
fn coach_seed(seed: u64) -> u64 {
    seed ^ 0xC0AC_4000_0000_0000
}

/// Card ids in play for both players and the stadium: what a client needs to name the targets of an action.
pub(crate) fn context(state: &State) -> Value {
    let view = ViewState::for_player(state, HUMAN);
    let in_play: Vec<Vec<Option<String>>> = view
        .players
        .iter()
        .map(|player| player.in_play.iter().map(|slot| slot.as_ref().map(|s| s.card.clone())).collect())
        .collect();
    json!({ "in_play": in_play, "stadium": view.stadium })
}

/// One action of either player, as the app reads it (`engine-cli play`'s `action` line, without its `type`).
pub(crate) fn action_line(ply: u32, before: &State, actor: usize, playable: &[Action], action: &Action) -> Value {
    json!({
        "ply": ply,
        "turn": before.turn_count,
        "actor": actor,
        "forced": playable.len() == 1,
        "text": action.action.to_string(),
        "action": action.action,
        "ctx": context(before),
    })
}

/// The bot's code: any of deckgym's or the f bots, but not a human («h») nor «x».
pub(crate) fn bot_code(code: &str) -> Result<BotCode, String> {
    match parse_bot_code(code)? {
        BotCode::Deckgym(PlayerCode::H | PlayerCode::X) => Err(format!("«{code}» no sirve como rival")),
        other => Ok(other),
    }
}

/// The coach's values as the owner sees them: `scores` rounded to a tenth and the `best` option.
pub(crate) fn coach_view(scores: &[f64]) -> Value {
    let rounded: Vec<f64> = scores.iter().map(|score| (score * 10.0).round() / 10.0).collect();
    json!({ "scores": rounded, "best": best_option(scores) })
}

/// «you», «bot» or «tie», from the owner's side.
pub(crate) fn winner_of(outcome: Option<GameOutcome>) -> &'static str {
    match outcome {
        Some(GameOutcome::Win(p)) if p == HUMAN => "you",
        Some(GameOutcome::Win(_)) => "bot",
        Some(GameOutcome::Tie) | None => "tie",
    }
}

/// The owner's seat: plays the answer `LiveGame::answer` was given, and hands the coach's values of that decision to
/// the replay (`last_scores`). `shown`: the options the owner chose from, in their order.
struct Owner {
    deck: Deck,
    answer: Rc<Cell<Option<usize>>>,
    scores: Rc<RefCell<Option<Vec<f64>>>>,
    shown: Rc<RefCell<Vec<Action>>>,
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

    fn last_scores(&self) -> Option<Vec<f64>> {
        self.scores.borrow().clone()
    }

    fn decision_fn(&mut self, _rng: &mut StdRng, _state: &State, possible_actions: &[Action]) -> Action {
        let i = self.answer.take().expect("the owner's answer is set before the owner's move is played");
        // The option number is the one the owner was shown: deckgym must ask the same options, in the same order (review
        // of #86).
        assert!(
            self.shown.borrow().as_slice() == possible_actions,
            "the owner chose from other options than the ones deckgym asks"
        );
        possible_actions[i].clone()
    }
}

/// The owner's decision the game is stopped at.
pub(crate) struct Decision {
    pub ply: u32,
    pub state: State,
    pub actions: Vec<Action>,
    /// The coach's values (full precision, as the replay records them), once computed or restored.
    pub scores: Option<Vec<f64>>,
}

/// What `LiveGame::step` did.
pub(crate) enum Step {
    /// The owner decides: the game waits for `answer`.
    Decide,
    /// The bot's move, or a forced one of the owner's, played from `before`.
    Played { before: State, actor: usize, playable: Vec<Action>, action: Action },
    Ended,
}

/// One game, stopped at each decision of the owner. `handler` is told of every action, as in deckgym's own loop (the
/// browser has none: it records the replay itself).
pub(crate) struct LiveGame<'a> {
    game: Game<'a>,
    answer: Rc<Cell<Option<usize>>>,
    scores: Rc<RefCell<Option<Vec<f64>>>>,
    shown: Rc<RefCell<Vec<Action>>>,
    /// Modo entrenador: both decks and the coach's seed.
    coach: Option<([Deck; 2], u64)>,
    ply: u32,
    pending: Option<Decision>,
}

impl<'a> LiveGame<'a> {
    pub fn new(
        deck_human: &Deck,
        deck_bot: &Deck,
        code: BotCode,
        seed: u64,
        coach: bool,
        handler: Option<&'a mut CompositeSimulationEventHandler>,
    ) -> LiveGame<'a> {
        let answer = Rc::new(Cell::new(None));
        let scores = Rc::new(RefCell::new(None));
        let bot = create_players(deck_human.clone(), deck_bot.clone(), vec![code.clone(), code])
            .pop()
            .expect("two players");
        let shown = Rc::new(RefCell::new(Vec::new()));
        let owner = Owner { deck: deck_human.clone(), answer: answer.clone(), scores: scores.clone(), shown: shown.clone() };
        let players: Vec<Box<dyn Player>> = vec![Box::new(owner), bot];
        let game = match handler {
            Some(handler) => Game::new_with_event_handlers(live_game_id(seed), players, seed, handler),
            None => Game::new(players, seed),
        };
        let coach = coach.then(|| ([deck_human.clone(), deck_bot.clone()], coach_seed(seed)));
        LiveGame { game, answer, scores, shown, coach, ply: 0, pending: None }
    }

    /// The owner's decisions so far (the last one may be pending).
    pub fn ply(&self) -> u32 {
        self.ply
    }

    pub fn has_coach(&self) -> bool {
        self.coach.is_some()
    }

    pub fn pending(&self) -> Option<&Decision> {
        self.pending.as_ref()
    }

    /// Plays on by one step: the owner's next decision (it waits there), one move played, or the end.
    pub fn step(&mut self) -> Step {
        if self.pending.is_some() {
            return Step::Decide;
        }
        if self.game.is_game_over() {
            return Step::Ended;
        }
        let state = self.game.get_state_clone();
        let (actor, playable) = state.generate_possible_actions();
        if actor == HUMAN && playable.len() > 1 {
            self.ply += 1;
            self.pending = Some(Decision { ply: self.ply, state, actions: playable, scores: None });
            return Step::Decide;
        }
        let action = self.game.play_tick();
        Step::Played { before: state, actor, playable, action }
    }

    /// Modo entrenador: the value of each option of the pending decision, computed once; none without it.
    pub fn coach(&mut self) -> Option<&[f64]> {
        let (decks, seed) = self.coach.as_ref()?;
        let pending = self.pending.as_mut()?;
        let scores = pending.scores.get_or_insert_with(|| {
            coach_scores(&pending.state, &pending.actions, decks, game_seed(*seed, u64::from(pending.ply)), COACH_SAMPLES)
        });
        Some(scores.as_slice())
    }

    /// The coach's values of the pending decision as computed before a rebuild, so they are not scored again.
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

    /// `{"type":"decide","ply","turn","state","actions"}` of the pending decision, with `coach` (`scores` rounded to
    /// a tenth and `best`) when it was scored.
    pub fn decide_message(&self) -> Option<Value> {
        let pending = self.pending.as_ref()?;
        let actions: Vec<Value> = pending
            .actions
            .iter()
            .enumerate()
            .map(|(i, a)| json!({ "i": i, "text": a.action.to_string(), "action": a.action }))
            .collect();
        let mut decide = json!({
            "type": "decide",
            "ply": pending.ply,
            "turn": pending.state.turn_count,
            "state": ViewState::for_player(&pending.state, HUMAN),
            "actions": actions,
        });
        if let Some(scores) = &pending.scores {
            decide["coach"] = coach_view(scores);
        }
        Some(decide)
    }

    /// Answers the pending decision with option `i` and plays it: the decision and the owner's move.
    pub fn answer(&mut self, i: usize) -> Result<(Decision, Action), String> {
        let pending = self.pending.take().ok_or("no hay ninguna decisión pendiente")?;
        if i >= pending.actions.len() {
            let message = format!("elegí un número de 0 a {}", pending.actions.len() - 1);
            self.pending = Some(pending);
            return Err(message);
        }
        // The replay records the coach's values next to the decision (deckgym asks the seat after its move).
        *self.scores.borrow_mut() = pending.scores.clone();
        self.shown.replace(pending.actions.clone());
        self.answer.set(Some(i));
        let action = self.game.play_tick();
        Ok((pending, action))
    }

    pub fn state(&self) -> State {
        self.game.get_state_clone()
    }
}

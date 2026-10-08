//! `engine-cli consistency <job.json> <result.json>`: how soon a deck has its key attacker ready (PLAN §3.7, Fase 8).
//!
//! Plays `games` games of the deck (seat 0, bot `bot`, e2 by default, never choosing to attack) against itself played
//! by `et` (a bot that only ends its turn): a «goldfish» opponent that never hits back, and a deck that never knocks it
//! out, so the game lasts and what is measured is how the deck sets up, not the fight. In each game it notes the first
//! own turn in which some key card (`keyCards`, engine ids) is in play with energy for one of its attacks, and the first
//! own turn in which the key card is active and the deck could attack with it. Split by who started. The cost check is
//! the plain one (attached energy against the attack's cost, Colorless taking any type); abilities that change energy
//! (Serperior) are not counted.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use deckgym::actions::{Action, SimpleAction};
use deckgym::models::{Card, EnergyType};
use deckgym::players::{create_players, Player, PlayerCode};
use deckgym::simulation_event_handler::{CompositeSimulationEventHandler, SimulationEventHandler};
use deckgym::state::PlayedCard;
use deckgym::{Deck, Game, State};
use rand::rngs::StdRng;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{game_id_for, game_seed, one, parse_players, require_simulable, thread_pool, CliError, Progress, CLI_VERSION, ENGINE_REV};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyJob {
    deck: String,
    /// Engine ids («B1 036») of the key attacker(s): any of them counts.
    key_cards: Vec<String>,
    games: u32,
    seed: u64,
    #[serde(default = "one")]
    threads: usize,
    /// Bot that plays the deck (default e2).
    #[serde(default = "default_bot")]
    bot: String,
    /// Own turns reported (default 8).
    #[serde(default = "default_max_turn")]
    max_turn: u8,
}

fn default_bot() -> String {
    "e2".to_string()
}

fn default_max_turn() -> u8 {
    8
}

/// Per own turn 1..=maxTurn, the games in which it happened first on that turn; `never` = not by maxTurn.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnHistogram {
    games: u32,
    first_on_turn: Vec<u32>,
    never: u32,
}

impl TurnHistogram {
    fn new(max_turn: u8) -> Self {
        TurnHistogram { games: 0, first_on_turn: vec![0; usize::from(max_turn)], never: 0 }
    }

    fn add(&mut self, turn: Option<u8>) {
        self.games += 1;
        match turn {
            Some(t) if t >= 1 && usize::from(t) <= self.first_on_turn.len() => self.first_on_turn[usize::from(t) - 1] += 1,
            _ => self.never += 1,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    /// Games where the deck started, and where it went second.
    first: TurnHistogram,
    second: TurnHistogram,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyResult {
    engine_rev: &'static str,
    cli_version: &'static str,
    bot: String,
    seed: u64,
    games: u32,
    max_turn: u8,
    key_cards: Vec<String>,
    /// In play with energy for one of its attacks.
    ready: Split,
    /// Active and able to attack.
    attack: Split,
    duration_ms: u128,
}

#[derive(Debug, Default, Clone, Copy)]
struct Watch {
    started: Option<bool>,
    ready: Option<u8>,
    attack: Option<u8>,
}

/// The deck's own turn number for a global turn: 1, 2… for the deck whether it started or not.
fn own_turn(turn_count: u8, started: bool) -> u8 {
    (turn_count + u8::from(started)) / 2
}

/// Attached energy against a cost: typed energy first, then anything left for Colorless.
fn pays(attached: &[EnergyType], cost: &[EnergyType]) -> bool {
    let mut left: Vec<EnergyType> = attached.to_vec();
    let mut colorless = 0usize;
    for energy in cost {
        if *energy == EnergyType::Colorless {
            colorless += 1;
            continue;
        }
        match left.iter().position(|e| e == energy) {
            Some(at) => {
                left.remove(at);
            }
            None => return false,
        }
    }
    left.len() >= colorless
}

fn can_attack(card: &PlayedCard) -> bool {
    match &card.card {
        Card::Pokemon(pokemon) => pokemon.attacks.iter().any(|attack| pays(&card.attached_energy, &attack.energy_required)),
        _ => false,
    }
}

/** Plays like its bot but never chooses to attack (when something else is possible): the opponent stays alive. */
struct NoAttack {
    inner: Box<dyn Player>,
}

impl std::fmt::Debug for NoAttack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?} sin atacar", self.inner)
    }
}

impl Player for NoAttack {
    fn get_deck(&self) -> Deck {
        self.inner.get_deck()
    }

    fn decision_fn(&mut self, rng: &mut StdRng, state: &State, possible_actions: &[Action]) -> Action {
        let calm: Vec<Action> = possible_actions
            .iter()
            .filter(|a| !matches!(a.action, SimpleAction::Attack(_)))
            .cloned()
            .collect();
        if calm.is_empty() {
            self.inner.decision_fn(rng, state, possible_actions)
        } else {
            self.inner.decision_fn(rng, state, &calm)
        }
    }
}

struct ReadyWatch {
    key: Arc<BTreeSet<String>>,
    watch: Arc<Mutex<Watch>>,
}

impl SimulationEventHandler for ReadyWatch {
    fn merge(&mut self, _other: &dyn SimulationEventHandler) {}

    fn on_action(&mut self, _game_id: Uuid, state: &State, actor: usize, playable: &[Action], _action: &Action) {
        let mut watch = self.watch.lock().expect("watch");
        if watch.started.is_none() && state.turn_count >= 1 {
            watch.started = Some(state.current_player == 0);
        }
        let Some(started) = watch.started else { return };
        if actor != 0 || state.turn_count == 0 {
            return;
        }
        let own = own_turn(state.turn_count, started);
        let key = |card: &PlayedCard| self.key.contains(&card.get_id());
        if watch.ready.is_none()
            && state.in_play_pokemon[0].iter().flatten().any(|card| key(card) && can_attack(card))
        {
            watch.ready = Some(own);
        }
        if watch.attack.is_none()
            && state.in_play_pokemon[0][0].as_ref().is_some_and(key)
            && playable.iter().any(|a| matches!(a.action, SimpleAction::Attack(_)))
        {
            watch.attack = Some(own);
        }
    }
}

pub fn consistency(job: ConsistencyJob) -> Result<ConsistencyResult, CliError> {
    let deck = require_simulable("del mazo", &job.deck)?;
    if job.key_cards.is_empty() {
        return Err(CliError::input("keyCards: indicá al menos una carta clave"));
    }
    let present: BTreeSet<String> = deck.cards.iter().map(|card| card.get_id()).collect();
    if !job.key_cards.iter().any(|id| present.contains(id)) {
        return Err(CliError::input("ninguna carta clave está en el mazo"));
    }
    // deckgym reads «et» as an expectiminimax depth: the passive bot is named directly.
    let bot = parse_players(&[job.bot.clone(), job.bot.clone()])?.remove(0);
    let codes: Vec<PlayerCode> = vec![bot, PlayerCode::ET];
    let key = Arc::new(job.key_cards.iter().cloned().collect::<BTreeSet<_>>());
    let pool = thread_pool(job.threads)?;
    eprintln!("total {}", job.games);
    let progress = Progress::start();
    let started = Instant::now();
    let watches: Vec<Result<Watch, String>> = pool.install(|| {
        (0..job.games)
            .into_par_iter()
            .map(|index| {
                let seed = game_seed(job.seed, u64::from(index));
                let watch = Arc::new(Mutex::new(Watch::default()));
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut handler = CompositeSimulationEventHandler::new(vec![Box::new(ReadyWatch {
                        key: key.clone(),
                        watch: watch.clone(),
                    })]);
                    let mut players = create_players(deck.clone(), deck.clone(), codes.clone());
                    let inner = players.remove(0);
                    players.insert(0, Box::new(NoAttack { inner }));
                    let mut game = Game::new_with_event_handlers(game_id_for(job.seed, u64::from(index)), players, seed, &mut handler);
                    game.play();
                }));
                progress.tick();
                outcome
                    .map(|()| *watch.lock().expect("watch"))
                    .map_err(|_| format!("la partida con semilla {seed} falló"))
            })
            .collect()
    });
    let duration_ms = started.elapsed().as_millis();
    drop(progress);
    let mut ready = Split { first: TurnHistogram::new(job.max_turn), second: TurnHistogram::new(job.max_turn) };
    let mut attack = Split { first: TurnHistogram::new(job.max_turn), second: TurnHistogram::new(job.max_turn) };
    for watch in watches {
        let watch = watch.map_err(CliError::engine)?;
        let (r, a) = if watch.started == Some(false) {
            (&mut ready.second, &mut attack.second)
        } else {
            (&mut ready.first, &mut attack.first)
        };
        r.add(watch.ready);
        a.add(watch.attack);
    }
    Ok(ConsistencyResult {
        engine_rev: ENGINE_REV,
        cli_version: CLI_VERSION,
        bot: job.bot,
        seed: job.seed,
        games: job.games,
        max_turn: job.max_turn,
        key_cards: job.key_cards,
        ready,
        attack,
        duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_turns_count_from_one_for_both_seats() {
        assert_eq!(own_turn(1, true), 1);
        assert_eq!(own_turn(3, true), 2);
        assert_eq!(own_turn(2, false), 1);
        assert_eq!(own_turn(4, false), 2);
    }

    #[test]
    fn typed_energy_first_then_colorless() {
        use EnergyType::{Colorless, Fire, Water};
        assert!(pays(&[Fire, Fire], &[Fire, Colorless]));
        assert!(pays(&[Fire, Water], &[Fire, Colorless]));
        assert!(!pays(&[Water, Water], &[Fire, Colorless]));
        assert!(!pays(&[Fire], &[Fire, Colorless]));
        assert!(pays(&[], &[]));
    }
}

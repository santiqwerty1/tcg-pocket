//! Modo entrenador (Fase 20): how good each option of one of the owner's decisions is, by the same yardstick as the
//! engine's bots. Each option is played `samples` times to the end of the owner's turn — the owner's deck shuffled
//! first (the order of one's own deck is unknown), the rest of the turn played by the e2 bot — and the table is scored
//! with deckgym's baseline value function (points ×10.000, a Pokémon ready to attack ×500, turns until the rival wins
//! ×100, HP, cards…). The samples use their own seeds, the same for every option (common random numbers), and never
//! the game's: a game replays the same with or without the coach.

use deckgym::actions::Action;
use deckgym::players::{baseline_value_function, create_players, PlayerCode};
use deckgym::{Deck, Game, State};
use rand::rngs::StdRng;
use rand::SeedableRng;
use rayon::prelude::*;

use crate::game_seed;

/// Samples per option.
pub const COACH_SAMPLES: u64 = 12;
/// Ticks after the option before giving up on the turn ending (deckgym caps the actions of a turn anyway).
const MAX_TICKS: usize = 200;

/// The value of each option (same order as `actions`), higher is better for the player deciding.
pub fn coach_scores(state: &State, actions: &[Action], decks: &[Deck; 2], seed: u64, samples: u64) -> Vec<f64> {
    let me = actions[0].actor;
    actions
        .par_iter()
        .map(|action| {
            let total: f64 = (0..samples)
                .map(|k| {
                    let sample_seed = game_seed(seed, k);
                    let mut start = state.clone();
                    start.decks[me].shuffle(false, &mut StdRng::seed_from_u64(sample_seed));
                    let players = create_players(
                        decks[0].clone(),
                        decks[1].clone(),
                        vec![PlayerCode::E { max_depth: 2 }, PlayerCode::E { max_depth: 2 }],
                    );
                    let mut game = Game::from_state(start, players, sample_seed);
                    game.apply_action(action);
                    let turn = state.turn_count;
                    let mut ticks = 0;
                    loop {
                        let now = game.get_state_clone();
                        if game.is_game_over() || now.current_player != me || now.turn_count != turn || ticks >= MAX_TICKS {
                            return baseline_value_function(&now, me);
                        }
                        game.play_tick();
                        ticks += 1;
                    }
                })
                .sum();
            total / samples as f64
        })
        .collect()
}

/// The best option (the first one on a tie).
pub fn best_option(scores: &[f64]) -> usize {
    let mut best = 0;
    for (i, score) in scores.iter().enumerate() {
        if *score > scores[best] {
            best = i;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALTARIA: &str = "Energy: Psychic
2 Swablu A4a 64
2 Mega Altaria ex B1 102
1 Jirachi B1 106
2 Chingling B1 109
1 Indeedee ex B1 121
1 Altaria B1 197
1 Sabrina A1 225
2 Rocky Helmet A2 148
1 Cyrus A2 150
1 Mars A2 155
1 Poké Ball A2b 111
2 Professor's Research A4b 373
1 Copycat B1 225
2 Lisia B1 226";

    #[test]
    fn scores_every_option_the_same_way_twice() {
        let deck = Deck::from_string(ALTARIA).expect("deck");
        let decks = [deck.clone(), deck.clone()];
        let players = create_players(deck.clone(), deck, vec![PlayerCode::R, PlayerCode::R]);
        let mut game = Game::new(players, 7);
        // Past the setup, to the first decision with options.
        let (state, actions) = loop {
            let state = game.get_state_clone();
            let (_, actions) = state.generate_possible_actions();
            if state.turn_count >= 1 && actions.len() > 1 {
                break (state, actions);
            }
            game.play_tick();
        };
        let first = coach_scores(&state, &actions, &decks, 11, 3);
        assert_eq!(first.len(), actions.len());
        assert!(first.iter().all(|score| score.is_finite()));
        assert_eq!(first, coach_scores(&state, &actions, &decks, 11, 3));
        assert!(best_option(&first) < actions.len());
    }

    #[test]
    fn the_best_is_the_highest_and_the_first_on_a_tie() {
        assert_eq!(best_option(&[1.0, 3.0, 2.0]), 1);
        assert_eq!(best_option(&[5.0, 5.0]), 0);
        assert_eq!(best_option(&[-1.0]), 0);
    }
}

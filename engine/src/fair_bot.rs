//! The bots engine-cli plays with: deckgym's own codes, plus «f<N>» (H-018).
//!
//! deckgym's expectiminimax (e<N>) scores a board with a clock — how many turns each side is from winning — that
//! only counts attacks with fixed damage (`value_functions.rs`, `calculate_turns_until_opponent_wins`). A Pokémon
//! whose attacks do no fixed damage (Ivysaur and its Synthesis) makes its side look 30 turns from winning, and the
//! clock weighs 100 per turn: the bot never evolves into it, and a deck built around it collapses (deck 40: 2,2 %
//! against the meta with bots, 38,9 % with people). «f<N>» is the same search with that clock's weight at 0 and a
//! clock of our own that (a) for its own side, looks through to the evolutions its deck and hand can still reach, one
//! more turn per stage to go (the rival's hand and deck are hidden: for the rival it counts only what is in play), and
//! (b) reads «N damage» out of attacks with no fixed damage that do some («This attack does 50 damage to 1 of your
//! opponent's Pokémon»), leaving out healing, the signed numbers of defensive effects («do −20 damage») and damage only
//! to the Bench. It also doubles attached Grass Energy under Serperior's Jungle Totem. Review of the bots' comments
//! (Laboratorio, 9/10): Energy and evolutions go on at the same time (one of each per turn), an attack needing an
//! Energy the deck's Energy Zone cannot make is no threat, and a slow threat is never worse than none.
//! deckgym-core is not modified.

use deckgym::card_logic::get_highest_evolutions;
use deckgym::models::{Attack, Card, EnergyType};
use deckgym::players::{
    create_players as deckgym_players, parametric_value_function, parse_player_code, ExpectiMiniMaxPlayer, Player,
    PlayerCode, ValueFunctionParams,
};
use deckgym::state::{has_serperior_jungle_totem, PlayedCard};
use deckgym::{Deck, State};

/// A bot: one of deckgym's codes, or expectiminimax with the clock that sees evolutions (H-018).
#[derive(Clone, Debug)]
pub enum BotCode {
    Deckgym(PlayerCode),
    Fair { max_depth: usize },
}

/// «f2» → our expectiminimax at depth 2; anything else, deckgym's codes.
pub fn parse_bot_code(code: &str) -> Result<BotCode, String> {
    let lower = code.to_ascii_lowercase();
    if let Some(depth) = lower.strip_prefix('f') {
        return match depth.parse::<usize>() {
            Ok(max_depth) if (1..=9).contains(&max_depth) => Ok(BotCode::Fair { max_depth }),
            _ => Err(format!("Invalid player code: {code}. Use 'f<1-9>', e.g. 'f2'")),
        };
    }
    parse_player_code(code).map(BotCode::Deckgym)
}

/// The two players of a game, like deckgym's `create_players`, with «f<N>» as well.
pub fn create_players(deck_a: Deck, deck_b: Deck, codes: Vec<BotCode>) -> Vec<Box<dyn Player>> {
    codes
        .into_iter()
        .zip([deck_a, deck_b])
        .map(|(code, deck)| match code {
            BotCode::Deckgym(code) => deckgym_players(deck.clone(), deck, vec![code.clone(), code]).remove(0),
            BotCode::Fair { max_depth } => Box::new(ExpectiMiniMaxPlayer {
                deck,
                max_depth,
                write_debug_trees: false,
                value_function: Box::new(fair_value_function),
            }) as Box<dyn Player>,
        })
        .collect()
}

/// deckgym's clock weight: a turn closer to winning is worth 100.
const CLOCK_WEIGHT: f64 = 100.0;
/// deckgym's value for «this side cannot hit at all».
const NO_THREAT: f64 = 30.0;

/// deckgym's baseline value function with its clock replaced by ours.
pub fn fair_value_function(state: &State, myself: usize) -> f64 {
    let mut params = ValueFunctionParams::baseline();
    params.turns_until_opponent_wins = 0.0;
    let opponent = (myself + 1) % 2;
    parametric_value_function(state, myself, &params)
        + (turns_to_win(state, opponent, false) - turns_to_win(state, myself, true)) * CLOCK_WEIGHT
}

/// Turns until `attacker` takes its 3 points: its quickest way to hit (energy, and with `see_evolutions` the
/// evolutions still in its deck and hand), then knocking out the defender's Active and its safest Benched Pokémon, as
/// deckgym's clock does.
pub fn turns_to_win(state: &State, attacker: usize, see_evolutions: bool) -> f64 {
    let defender = (attacker + 1) % 2;
    let no_cards: &[Card] = &[];
    let (deck, hand) = if see_evolutions {
        (state.decks[attacker].cards.as_slice(), state.hands[attacker].as_slice())
    } else {
        (no_cards, no_cards)
    };
    let jungle_totem = has_serperior_jungle_totem(state, attacker);
    // The Energy Zone is public: what it cannot make never gets attached.
    let zone = state.decks[attacker].energy_types();
    let mut best: Option<f64> = None;
    for (_, pokemon) in state.enumerate_in_play_pokemon(attacker) {
        for (setup, damage) in threats(pokemon, deck, hand, jungle_totem, zone) {
            let total = setup + knockout_turns(state, defender, damage, state.points[attacker]);
            best = Some(best.map_or(total, |b| b.min(total)));
        }
    }
    // A slow threat is never worse than none (bots' review, item 2).
    best.map_or(NO_THREAT, |b| b.min(NO_THREAT))
}

/// (turns before it can hit, damage) for each way a Pokémon in play can hit: its own attacks, and those of the
/// highest evolutions still in its deck or hand (energy stays attached when it evolves; a turn per stage to go, while
/// an Energy goes on each of those turns too). Attacks with an Energy `zone` cannot make are left out.
fn threats(
    pokemon: &PlayedCard,
    deck: &[Card],
    hand: &[Card],
    jungle_totem: bool,
    zone: &[EnergyType],
) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    let Card::Pokemon(own) = &pokemon.card else { return out };
    // Serperior's Jungle Totem: each Grass Energy on a Grass Pokémon counts twice.
    let attached = |grass_type: bool| -> Vec<EnergyType> {
        let mut energy = pokemon.attached_energy.clone();
        if jungle_totem && grass_type {
            energy.extend(pokemon.attached_energy.iter().filter(|e| **e == EnergyType::Grass).cloned());
        }
        energy
    };
    push_attacks(&mut out, &own.attacks, &attached(own.energy_type == EnergyType::Grass), 0, zone);
    if own.stage < 2 {
        let mut seen: Vec<String> = Vec::new();
        for evolution in get_highest_evolutions(&pokemon.card, deck).into_iter().chain(get_highest_evolutions(&pokemon.card, hand)) {
            let Card::Pokemon(evolved) = &evolution else { continue };
            if evolved.stage <= own.stage || seen.contains(&evolved.id) {
                continue;
            }
            seen.push(evolved.id.clone());
            let energy = attached(evolved.energy_type == EnergyType::Grass);
            push_attacks(&mut out, &evolved.attacks, &energy, usize::from(evolved.stage - own.stage), zone);
        }
    }
    out
}

fn push_attacks(
    out: &mut Vec<(f64, f64)>,
    attacks: &[Attack],
    attached: &[EnergyType],
    stages: usize,
    zone: &[EnergyType],
) {
    for attack in attacks {
        let damage = attack_damage(attack);
        if damage > 0 && reachable(attached, &attack.energy_required, zone) {
            // One Energy and one evolution a turn, at the same time (bots' review, item 1).
            let setup = missing_energy(attached, &attack.energy_required).max(stages);
            out.push((setup as f64, damage as f64));
        }
    }
}

/// Whether the typed Energy an attack still lacks can come from `zone` (an empty zone is taken as unknown: anything).
fn reachable(attached: &[EnergyType], cost: &[EnergyType], zone: &[EnergyType]) -> bool {
    if zone.is_empty() {
        return true;
    }
    let mut left: Vec<EnergyType> = attached.to_vec();
    for energy in cost.iter().filter(|e| **e != EnergyType::Colorless) {
        match left.iter().position(|e| e == energy) {
            Some(at) => {
                left.remove(at);
            }
            None if !zone.contains(energy) => return false,
            None => {}
        }
    }
    true
}

/// Fixed damage, or for an attack with none that still does some («This attack does 50 damage to 1 of your opponent's
/// Pokémon»), the first «N damage» of its text that is not healing, nor a signed defensive amount («do −20 damage»,
/// «takes −50 damage»), nor only to the Bench («… to 1 of your opponent's Benched Pokémon»: the clock knocks out the
/// Active first). 0 when it does none. (Attacks that do N per heads already carry it as fixed damage.)
pub fn attack_damage(attack: &Attack) -> u32 {
    if attack.fixed_damage > 0 {
        return attack.fixed_damage;
    }
    let Some(effect) = &attack.effect else { return 0 };
    let words: Vec<&str> = effect.split_whitespace().collect();
    for (at, word) in words.iter().enumerate() {
        let next = words.get(at + 1).map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()));
        if next != Some("damage") {
            continue;
        }
        if word.starts_with(['-', '−', '+']) {
            continue;
        }
        let Ok(amount) = word.trim_matches(|c: char| !c.is_ascii_digit()).parse::<u32>() else { continue };
        let before = if at > 0 { words[at - 1].to_ascii_lowercase() } else { String::new() };
        // The rest of its sentence says where it lands.
        let sentence = words[at + 1..].iter().position(|w| w.ends_with('.')).map_or(words.len(), |end| at + 2 + end);
        let bench_only = words[at + 1..sentence.min(words.len())].iter().any(|w| w.starts_with("Benched"));
        if amount > 0 && !before.starts_with("heal") && !bench_only {
            return amount;
        }
    }
    0
}

/// Energies an attack still lacks with what is attached (typed first, then Colorless with what is left).
fn missing_energy(attached: &[EnergyType], cost: &[EnergyType]) -> usize {
    let mut left: Vec<EnergyType> = attached.to_vec();
    let mut missing: usize = 0;
    let mut colorless: usize = 0;
    for energy in cost {
        if *energy == EnergyType::Colorless {
            colorless += 1;
            continue;
        }
        match left.iter().position(|e| e == energy) {
            Some(at) => {
                left.remove(at);
            }
            None => missing += 1,
        }
    }
    missing + colorless.saturating_sub(left.len())
}

/// Points a knocked-out Pokémon gives: Mega 3, ex 2, the rest 1 (deckgym's `get_knockout_points`, which is private).
fn knockout_points(card: &Card) -> u8 {
    match card {
        Card::Pokemon(pokemon) if pokemon.name.starts_with("Mega ") => 3,
        Card::Pokemon(pokemon) if pokemon.name.to_lowercase().split(' ').next_back() == Some("ex") => 2,
        _ => 1,
    }
}

/// Turns to take the points that are left hitting for `damage`: the Active first, then the safest Benched Pokémon
/// (as deckgym's clock, but each one once).
fn knockout_turns(state: &State, defender: usize, damage: f64, points: u8) -> f64 {
    let mut points = points;
    let mut turns = 0.0;
    if let Some(active) = state.maybe_get_active(defender) {
        turns += (active.get_remaining_hp() as f64 / damage).ceil();
        points += knockout_points(&active.card);
    }
    let mut bench: Vec<&PlayedCard> = state.enumerate_bench_pokemon(defender).map(|(_, card)| card).collect();
    while points < 3 && !bench.is_empty() {
        let safest = (0..bench.len())
            .max_by_key(|&at| {
                let card = bench[at];
                if points == 2 {
                    card.get_remaining_hp()
                } else {
                    card.get_remaining_hp() * 1000 / u32::from(knockout_points(&card.card).max(1))
                }
            })
            .unwrap_or(0);
        let card = bench.swap_remove(safest);
        turns += (card.get_remaining_hp() as f64 / damage).ceil();
        points += knockout_points(&card.card);
    }
    turns
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attack(fixed_damage: u32, effect: Option<&str>) -> Attack {
        Attack {
            energy_required: vec![EnergyType::Grass],
            title: "x".into(),
            fixed_damage,
            effect: effect.map(str::to_string),
        }
    }

    #[test]
    fn codes() {
        assert!(matches!(parse_bot_code("f2"), Ok(BotCode::Fair { max_depth: 2 })));
        assert!(matches!(parse_bot_code("F3"), Ok(BotCode::Fair { max_depth: 3 })));
        assert!(matches!(parse_bot_code("e2"), Ok(BotCode::Deckgym(PlayerCode::E { max_depth: 2 }))));
        assert!(parse_bot_code("f0").is_err());
        assert!(parse_bot_code("fx").is_err());
    }

    #[test]
    fn damage_is_read_from_real_texts() {
        assert_eq!(attack_damage(&attack(60, None)), 60);
        // Texts from deckgym's database (33ff2a5) of attacks with no fixed damage.
        let text = |effect: &str| attack_damage(&attack(0, Some(effect)));
        assert_eq!(text("This attack does 50 damage to 1 of your opponent's Pokémon."), 50); // Seadra
        assert_eq!(text("1 of your opponent's Pokémon is chosen at random 4 times. For each time a Pokémon was chosen, do 50 damage to it."), 50); // Dragonite
        assert_eq!(text("During your opponent's next turn, attacks used by the Defending Pokémon do -20 damage."), 0); // Cubone
        assert_eq!(text("During your opponent's next turn, this Pokémon takes -50 damage from attacks."), 0); // Cosmoem
        assert_eq!(text("Heal 20 damage from this Pokémon."), 0); // Piplup
        // Only to the Bench: it cannot knock out the Active (bots' review, item 4).
        assert_eq!(text("This attack does 30 damage to 1 of your opponent's Benched Pokémon."), 0); // Hitmonlee
        assert_eq!(text("This attack does 70 damage to 1 of your opponent's Benched Pokémon."), 0); // Indeedee
        // The Active can be the target: these count.
        assert_eq!(text("Choose a spot from among your opponent's Active Spot and Bench. At the end of your opponent's next turn, do 70 damage to the Pokémon in the spot you chose."), 70); // Meowscarada ex
        assert_eq!(text("Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 50 damage to the new Active Pokémon."), 50); // Sandy Shocks
        assert_eq!(text("Take a [G] Energy from your Energy Zone and attach it to 1 of your [G] Pokémon."), 0); // Ivysaur
    }

    const VENUSAUR: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64\n";

    /// A board: player 0 has `active` (no Energy) and the Venusaur deck, empty hand; player 1, a Bulbasaur (70 HP).
    fn board(active: &str) -> State {
        use deckgym::card_ids::CardId;
        use deckgym::Game;
        let id = |text: &str| CardId::from_card_id(text).expect("card id");
        let venusaur = Deck::from_string(VENUSAUR).expect("deck");
        let rival = Deck::from_string(crate::coach::tests::ALTARIA).expect("deck");
        let players = deckgym_players(venusaur.clone(), rival, vec![PlayerCode::R, PlayerCode::R]);
        let mut game = Game::new(players, 7);
        game.play_until_stable();
        let mut state = game.get_state_clone();
        state.set_board(vec![PlayedCard::from_id(id(active))], vec![PlayedCard::from_id(id("A1 001"))]);
        state.decks[0] = venusaur;
        state.hands[0].clear();
        state.points = [0, 0];
        state
    }

    #[test]
    fn the_clock_sees_the_evolutions_of_its_own_side_only() {
        let ivysaur = board("B1a 002");
        // Ivysaur's only attack does no damage: deckgym's clock (and ours without evolutions) says it cannot hit.
        assert_eq!(turns_to_win(&ivysaur, 0, false), NO_THREAT);
        // With the Mega Venusaur ex still in the deck: one stage and its Energy to go, then 70 HP at 120 a hit.
        let seen = turns_to_win(&ivysaur, 0, true);
        assert!(seen < NO_THREAT, "{seen}");
        // The rival's Bulbasaur (Vine Whip 40) against Ivysaur's 90 HP: 3 hits. But the rival's deck (Altaria) only
        // makes Psychic Energy, so its Vine Whip never gets its [G] (bots' review, item 3): no threat.
        assert_eq!(knockout_turns(&ivysaur, 0, 40.0, 0), 3.0);
        assert_eq!(turns_to_win(&ivysaur, 1, false), NO_THREAT);
    }

    #[test]
    fn evolving_into_ivysaur_no_longer_looks_like_a_loss() {
        use deckgym::players::baseline_value_function;
        let bulbasaur = board("A1 001");
        let ivysaur = board("B1a 002");
        // deckgym's value: evolving drops ~2.500 (its clock jumps to 30 turns). Ours: at most a couple of turns of clock
        // (with no Energy yet, Bulbasaur's Vine Whip still hits sooner than Mega Venusaur ex), so the search evolves.
        let drop = |value: fn(&State, usize) -> f64| value(&bulbasaur, 0) - value(&ivysaur, 0);
        assert!(drop(baseline_value_function) > 2000.0, "{}", drop(baseline_value_function));
        assert!(drop(fair_value_function) < 500.0, "{}", drop(fair_value_function));
    }

    #[test]
    fn f2_evolves_where_e2_does_not_and_repeats_with_the_seed() {
        let run = |bot: &str| {
            crate::simulate(crate::SimulateJob {
                deck_a: VENUSAUR.to_string(),
                deck_b: crate::coach::tests::ALTARIA.to_string(),
                players: vec![bot.to_string(), bot.to_string()],
                games: 12,
                seed: 20261009,
                threads: 2,
                replay_sample: 0,
                replay_dir: None,
                per_game: true,
            })
            .expect("simulate")
        };
        let stages = |bot: &str| run(bot).per_game.expect("perGame").stages_a;
        // e2 never takes Bulbasaur past Basic; f2 gets Mega Venusaur ex out.
        assert!(stages("e2").chars().all(|c| c == '0'), "{}", stages("e2"));
        assert!(stages("f2").contains('2'), "{}", stages("f2"));
        assert_eq!(run("f2").per_game.expect("perGame").winners, run("f2").per_game.expect("perGame").winners);
    }

    #[test]
    fn players_accept_f_and_still_refuse_humans() {
        assert!(crate::parse_players(&["f2".to_string(), "e2".to_string()]).is_ok());
        assert!(crate::parse_players(&["f2".to_string(), "h".to_string()]).is_err());
        assert!(crate::parse_players(&["x".to_string(), "f2".to_string()]).is_err());
    }

    #[test]
    fn energy_and_evolutions_go_on_together() {
        // Bots' review, item 1: Bulbasaur (no Energy) with Mega Venusaur ex in the deck. Its Giant Bloom costs 3 [G] and
        // 1 more: 4 Energy and 2 stages take 4 turns, not 6 (an Energy goes on while it evolves).
        let bulbasaur = board("A1 001");
        let pokemon = bulbasaur.enumerate_in_play_pokemon(0).next().expect("in play").1.clone();
        let deck = bulbasaur.decks[0].cards.clone();
        let zone = bulbasaur.decks[0].energy_types().to_vec();
        let setups: Vec<f64> = threats(&pokemon, &deck, &[], false, &zone).into_iter().map(|(setup, _)| setup).collect();
        let Card::Pokemon(mega) = PlayedCard::from_id(deckgym::card_ids::CardId::from_card_id("B1a 004").expect("id")).card else {
            panic!("Mega Venusaur ex")
        };
        let cost = mega.attacks.iter().map(|attack| attack.energy_required.len()).max().expect("attack");
        assert!(setups.contains(&(cost.max(2) as f64)), "{setups:?} (cost {cost})");
        assert!(!setups.iter().any(|setup| *setup > cost.max(2) as f64), "{setups:?}");
    }

    #[test]
    fn energy_the_zone_cannot_make_is_no_threat() {
        use EnergyType::{Colorless, Grass, Water};
        // Bots' review, item 3: a [W] attack in a Grass deck never gets its Energy.
        assert!(!reachable(&[], &[Water, Colorless], &[Grass]));
        assert!(reachable(&[Water], &[Water, Colorless], &[Grass]));
        assert!(reachable(&[], &[Grass, Colorless], &[Grass]));
        assert!(reachable(&[], &[Water], &[]));
        // On a real board: the Venusaur deck is Grass only, so its Bulbasaur's [G] Vine Whip counts.
        let bulbasaur = board("A1 001");
        assert!(turns_to_win(&bulbasaur, 0, false) < NO_THREAT);
    }

    #[test]
    fn a_slow_threat_is_never_worse_than_none() {
        use deckgym::card_ids::CardId;
        // Bots' review, item 2: Cottonee's Attach (10) against three 150 HP Pokémon of one point each takes 45 turns and
        // 1 Energy; above NO_THREAT, having that attack would look worse than having none.
        let id = |text: &str| PlayedCard::from_id(CardId::from_card_id(text).expect("card id"));
        let mut state = board("A1 001");
        state.set_board(vec![id("A1 027")], vec![id("A1 211"), id("A1 250"), id("B2 109")]);
        assert_eq!(knockout_turns(&state, 1, 10.0, 0), 45.0);
        assert_eq!(turns_to_win(&state, 0, false), NO_THREAT);
    }

    #[test]
    fn energy_still_missing() {
        use EnergyType::{Colorless, Fire, Grass};
        assert_eq!(missing_energy(&[], &[Grass, Colorless]), 2);
        assert_eq!(missing_energy(&[Grass], &[Grass, Colorless]), 1);
        assert_eq!(missing_energy(&[Fire, Grass], &[Grass, Colorless]), 0);
        assert_eq!(missing_energy(&[Fire], &[Grass]), 1);
    }
}

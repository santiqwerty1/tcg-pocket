//! «g<N>» (docs/BOTS.md, line 1 of the bots, 14/10/2026): deckgym's expectiminimax, like e and f, with an evaluation
//! whose damage comes from the engine itself. f's clock reads «N damage» out of a card's text and takes an attack's
//! `fixed_damage` as what it does; the engine knows better: Dede-Circuit does 40 for each Pokémon with a Tool (its
//! `fixed_damage` is 40 with none), Latias' Crossing Flights 20 more with Latios on the Bench, nothing against
//! Oricorio's Safeguard. g asks the engine (`expected_attack_damage`, an export of the fork, D-031) for the expected
//! damage of each attack against each Pokémon it can hit, and adds what the clock missed:
//! - damage already scheduled (Cursed Prose's 90, poison, burn) comes off the target's HP before counting hits;
//! - an attack that charges its own Energy (Ivysaur's Synthesis) makes its line ready sooner;
//! - an attack that discards its Energy (Latios' Luster Purge) can only hit every so many turns;
//! - a Benched attacker waits for the Active to retreat, and an Asleep or Paralyzed Active loses its turn.
//!
//! Only what a player sees: the board, the Energy Zones, the own deck list and hand; the rival's hand and deck are
//! unknown cards on the copy it evaluates (`hide`), so neither its evolutions nor an attack that counts them leak. The search is deckgym's, unchanged (it still sees the draws: line 2). deckgym is not changed
//! here, and no game of another bot changes.

use deckgym::actions::{expected_attack_damage, Mechanic, EFFECT_MECHANIC_MAP};
use deckgym::card_logic::get_highest_evolutions;
use deckgym::effects::{CardEffect, TurnEffect};
use deckgym::get_retreat_cost;
use deckgym::models::{Attack, Card, EnergyType, TrainerCard, TrainerType};
use deckgym::players::{parametric_value_function, ValueFunctionParams};
use deckgym::state::observation::knockout_points;
use deckgym::state::PlayedCard;
use deckgym::State;

use crate::fair_bot::{attack_damage, missing_energy, reachable};

/// The weights of g's evaluation (line 3 tunes them; docs/BOTS.md § Pesos).
#[derive(Clone, Copy, Debug)]
pub struct GParams {
    /// deckgym's linear terms (points, HP × Energy, hand, the Active's Tool…), with deckgym's own clock at 0.
    pub base: ValueFunctionParams,
    /// What a turn closer to winning is worth (deckgym's clock weighs 100).
    pub clock: f64,
    /// How much of the damage already scheduled on a Pokémon counts (switching clears Cursed Prose's).
    pub pending: f64,
}

impl Default for GParams {
    /// f's weights: deckgym's baseline with its clock replaced by g's.
    fn default() -> Self {
        let mut base = ValueFunctionParams::baseline();
        base.turns_until_opponent_wins = 0.0;
        GParams { base, clock: 100.0, pending: 1.0 }
    }
}

/// deckgym's value for «this side cannot hit at all» (f's too).
pub const NO_THREAT: f64 = 30.0;
/// Poison takes 10 at each Pokémon Checkup, and there is one at the end of every turn: 20 a round.
const POISON_ROUND: f64 = 20.0;
/// A burn does 20 at the next Checkup and, if the coin does not heal it, 20 at the one after.
const BURN_ROUND: f64 = 30.0;
/// An Asleep Pokémon flips at every Checkup: on average it loses 2/3 of its next turns.
const ASLEEP_TURNS: f64 = 2.0 / 3.0;

/// g's evaluation of `state` for `myself`.
pub fn g_value_function(state: &State, myself: usize, params: &GParams) -> f64 {
    let opponent = (myself + 1) % 2;
    // One copy per evaluation, with what `myself` cannot see hidden: the attackers and defenders take the Active spot
    // on it in turn, and deckgym's own terms are read from it too (its «Active ready» looks for evolutions in the deck
    // and hand of each side).
    let mut probe = state.clone();
    hide(&mut probe, opponent);
    let clock = turns_to_win(&mut probe, opponent, false, params) - turns_to_win(&mut probe, myself, true, params);
    parametric_value_function(&probe, myself, &params.base) + clock * params.clock
}

/// The rival's hand and deck as unknown cards, so far as `state` is a copy for the evaluation: how many there are is
/// public, what they are is not. An attack that counts them (Porygon-Z's Cyberjack, the Trainers in its rival's deck;
/// Lillipup's Puppy Pile, the Pokémon in its own hand) sees Items with no name. The Energy Zone stays: it is public.
pub fn hide(state: &mut State, rival: usize) {
    let unknown = Card::Trainer(TrainerCard {
        id: "UNKNOWN".to_string(),
        trainer_card_type: TrainerType::Item,
        name: "Unknown".to_string(),
        effect: String::new(),
        rarity: String::new(),
        booster_pack: String::new(),
    });
    state.hands[rival].fill(unknown.clone());
    state.decks[rival].cards.fill(unknown);
}

/// One Pokémon of the side being knocked out, as the clock sees it.
#[derive(Clone, Copy, Debug)]
struct Target {
    slot: usize,
    /// Remaining HP minus the damage already scheduled on it.
    hp: f64,
    points: u8,
    /// The poison it takes in a round (both Checkups), 0 if it is not Poisoned: it keeps falling until the knockout.
    poison: f64,
}

/// Turns until `attacker` takes its 3 points: its quickest way to hit (with `see_evolutions`, also the evolutions
/// still in its deck and hand), then knocking out the defender's Active and, in turn, the Benched Pokémon that cost it
/// the most hits per point, as f's clock does. `probe` is a copy of the state; it is changed while counting and left
/// as it was.
pub fn turns_to_win(probe: &mut State, attacker: usize, see_evolutions: bool, params: &GParams) -> f64 {
    let defender = (attacker + 1) % 2;
    let slots: Vec<usize> = (0..4).filter(|&i| probe.in_play_pokemon[attacker][i].is_some()).collect();
    let targets: Vec<Target> = (0..4)
        .filter_map(|slot| {
            let pokemon = probe.in_play_pokemon[defender][slot].as_ref()?;
            Some(Target {
                slot,
                hp: pokemon.get_remaining_hp() as f64 - params.pending * pending_damage(probe, defender, slot),
                points: knockout_points(&pokemon.card),
                poison: if pokemon.is_poisoned() { 2.0 * pokemon.public_details().poison_damage as f64 } else { 0.0 },
            })
        })
        .collect();
    if slots.is_empty() || targets.is_empty() {
        return NO_THREAT;
    }
    // The attack and retreat mechanics read the turn's player and the turn's effects: the copy goes to the attacker's
    // turn, this one or (for the rival of the player whose turn it is) the next one, where this turn's effects (a
    // Supporter's extra damage) no longer count and the ones left for it (less damage from its attacks) do.
    let (turn, turn_count) = (probe.current_player, probe.turn_count);
    if attacker != turn {
        probe.turn_count = turn_count.saturating_add(1);
    }
    probe.current_player = attacker;
    // The Energy Zone is public: what it cannot make never gets attached.
    let zone: Vec<EnergyType> = probe.decks[attacker].energy_types().to_vec();
    // A Benched attacker needs the Active out of the way: the Energy its retreat still lacks.
    let retreat_need = probe.in_play_pokemon[attacker][0]
        .as_ref()
        .map_or(0, |active| get_retreat_cost(probe, active).len().saturating_sub(active.attached_energy.len()));
    let candidates = attackers(probe, attacker, &slots, see_evolutions);
    let active_lost = probe.in_play_pokemon[attacker][0].as_ref().map_or(0.0, |active| {
        if active.is_paralyzed() {
            1.0
        } else if active.is_asleep() {
            ASLEEP_TURNS
        } else {
            0.0
        }
    });
    let mut best = NO_THREAT;
    for (slot, evolution) in candidates {
        let Some(in_play) = probe.in_play_pokemon[attacker][slot].as_ref() else { continue };
        // What the Active charges itself each turn while its line gets ready (Synthesis: 2 [G]); a Benched Pokémon
        // cannot use its attack, so it gets one Energy a turn.
        let rate = if slot == 0 { 1.0 + self_charge(&in_play.card) } else { 1.0 };
        let stages = evolution.as_ref().map_or(0, |card| stage(card).saturating_sub(stage(&in_play.card)));
        // An Asleep or Paralyzed Active can neither attack nor retreat: it holds back its own attack and a Benched
        // attacker's way in alike. Evolving it cures it.
        let lost = if slot == 0 && evolution.is_some() { 0.0 } else { active_lost };
        let promote = if slot == 0 { 0 } else { retreat_need };

        probe.in_play_pokemon[attacker].swap(0, slot);
        let saved = evolution.map(|card| {
            let active = probe.in_play_pokemon[attacker][0].as_mut().expect("in play");
            std::mem::replace(&mut active.card, card)
        });
        let attacks = match &probe.in_play_pokemon[attacker][0].as_ref().expect("in play").card {
            Card::Pokemon(pokemon) => pokemon.attacks.clone(),
            _ => Vec::new(),
        };
        let attached = probe.effective_attached_energy(attacker, 0);
        let own_type = match &probe.in_play_pokemon[attacker][0].as_ref().expect("in play").card {
            Card::Pokemon(pokemon) => Some(pokemon.energy_type),
            _ => None,
        };
        for attack in &attacks {
            let cost = probe.effective_attack_cost(attacker, attack);
            if !reachable(&attached, &cost, &zone) {
                continue;
            }
            // One Energy a turn from the zone, for the attacker and for the Active's retreat alike.
            let setup = ((missing_energy(&attached, &cost) as f64 / rate).ceil() + promote as f64).max(stages as f64) + lost;
            // The damage it does once ready: the Energy it still lacks goes on the copy first (Mega Burst does 50 for
            // each Energy it discards, Fighting Pulse more with an extra one).
            let extra = energy_to_attack(&attached, &cost, &zone, own_type);
            let active = probe.in_play_pokemon[attacker][0].as_mut().expect("in play");
            let had = active.attached_energy.len();
            active.attached_energy.extend(extra.iter().copied());
            let ready: Vec<EnergyType> = attached.iter().chain(extra.iter()).copied().collect();
            // An attack that discards its Energy waits until it is back: one Energy a turn, more with a charge. With a
            // coin, the expected wait: each outcome rounded to whole turns first.
            let (discard, chance) = self_discard(attack, &ready, &cost);
            let reuse = chance * (discard / rate).ceil().max(1.0) + (1.0 - chance);
            let damage: Vec<f64> =
                targets.iter().map(|target| damage_against(probe, attacker, attack, target.slot, target.poison)).collect();
            probe.in_play_pokemon[attacker][0].as_mut().expect("in play").attached_energy.truncate(had);
            if let Some(hits) = hits_to_win(&targets, &damage, probe.points[attacker]) {
                best = best.min(setup + hits + (hits - 1.0).max(0.0) * (reuse - 1.0));
            }
        }
        if let Some(card) = saved {
            probe.in_play_pokemon[attacker][0].as_mut().expect("in play").card = card;
        }
        probe.in_play_pokemon[attacker].swap(0, slot);
    }
    probe.current_player = turn;
    probe.turn_count = turn_count;
    // A slow threat is never worse than none (f's bots' review, item 2).
    best.min(NO_THREAT)
}

/// What `attack`, used by `attacker`'s Active, does to the defender's Pokémon at `slot` per hit: the engine's expected
/// damage with that Pokémon in the Active Spot, the damage it leaves for later, and a round of poison: the `poison` the
/// target already takes (it keeps falling every round until the knockout), or the attack's own if it poisons one that
/// is not yet. `probe` must have `attacker`'s turn; it is left as it was.
///
/// The engine counts only the damage an attack carries as data. One that also hits a Benched Pokémon of the
/// attacker's choice applies all its damage after that choice, so it gives 0 as soon as there is a Bench: it is asked
/// again with the Benches off the copy (its hit to the Active, with weakness and the rest). One that picks any of the
/// rival's Pokémon, with no fixed damage, gives 0 too: there it is the amount its text says, as f reads it (the target
/// is the attacker's choice, so it can be this one), except for one that only picks a damaged Pokémon when this one
/// is not.
pub fn damage_against(probe: &mut State, attacker: usize, attack: &Attack, slot: usize, poison: f64) -> f64 {
    let defender = (attacker + 1) % 2;
    let mechanic = mechanic(attack);
    probe.in_play_pokemon[defender].swap(0, slot);
    let mut damage = expected_attack_damage(probe, attacker, attack, defender, 0);
    let chooses_bench = matches!(
        mechanic,
        Some(
            Mechanic::AlsoChoiceBenchDamage { .. }
                | Mechanic::AlsoChoiceBenchDamageIfDamaged { .. }
                | Mechanic::CoinFlipAlsoChoiceBenchDamage { .. }
                | Mechanic::SelfDiscardEnergyAndChoiceBenchDamage { .. }
                | Mechanic::AlsoChoiceOwnPokemonDamage { .. }
        )
    );
    if damage == 0.0 && chooses_bench {
        let benches: Vec<Vec<Option<PlayedCard>>> =
            (0..2).map(|player| (1..4).map(|at| probe.in_play_pokemon[player][at].take()).collect()).collect();
        damage = expected_attack_damage(probe, attacker, attack, defender, 0);
        for (player, bench) in benches.into_iter().enumerate() {
            for (at, pokemon) in bench.into_iter().enumerate() {
                probe.in_play_pokemon[player][at + 1] = pokemon;
            }
        }
    }
    let damaged = probe.in_play_pokemon[defender][0].as_ref().is_some_and(|target| target.public_details().damage > 0);
    probe.in_play_pokemon[defender].swap(0, slot);
    let only_damaged = matches!(mechanic, Some(Mechanic::DirectDamageIfDamaged { .. }));
    let poison_instead = matches!(mechanic, Some(Mechanic::InflictPoisonWithDamage { .. }));
    if damage == 0.0 && attack.fixed_damage == 0 && !chooses_bench && !poison_instead && (damaged || !only_damaged) {
        damage = attack_damage(attack) as f64;
    }
    damage += match mechanic {
        Some(Mechanic::DamageAndCardEffect { effect: CardEffect::DelayedDamage { amount }, coin_flip, .. }) => {
            // f's reading of the text already took it (an attack with no fixed damage).
            if attack.fixed_damage == 0 && damage > 0.0 {
                0.0
            } else {
                *amount as f64 * if *coin_flip { 0.5 } else { 1.0 }
            }
        }
        _ => 0.0,
    };
    if poison > 0.0 {
        if damage > 0.0 {
            damage += poison;
        }
    } else {
        damage += match mechanic {
            // «Do 20 damage to this Pokémon instead of the usual amount»: at each Checkup.
            Some(Mechanic::InflictPoisonWithDamage { poison_damage }) => 2.0 * *poison_damage as f64,
            _ if damage > 0.0 && attack.effect.as_deref().is_some_and(|effect| effect.contains("is now Poisoned")) => POISON_ROUND,
            _ => 0.0,
        };
    }
    damage
}

/// The Energy `attached` still lacks to pay `cost`: each typed one, and for the Colorless ones the Pokémon's own type
/// if the zone makes it, else the zone's first (an empty zone is taken as unknown: the Pokémon's type).
fn energy_to_attack(attached: &[EnergyType], cost: &[EnergyType], zone: &[EnergyType], own: Option<EnergyType>) -> Vec<EnergyType> {
    let mut left: Vec<EnergyType> = attached.to_vec();
    let mut extra = Vec::new();
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
            None => extra.push(*energy),
        }
    }
    let filler = match own {
        Some(own) if zone.is_empty() || zone.contains(&own) => own,
        _ => zone.first().copied().unwrap_or(EnergyType::Colorless),
    };
    extra.extend(std::iter::repeat(filler).take(colorless.saturating_sub(left.len())));
    extra
}

/// Each Pokémon in play, and with `see_evolutions` each highest evolution of it still in the deck or hand.
fn attackers(state: &State, attacker: usize, slots: &[usize], see_evolutions: bool) -> Vec<(usize, Option<Card>)> {
    let mut out = Vec::new();
    for &slot in slots {
        out.push((slot, None));
        let Some(pokemon) = state.in_play_pokemon[attacker][slot].as_ref() else { continue };
        if !see_evolutions || stage(&pokemon.card) >= 2 {
            continue;
        }
        let mut seen: Vec<String> = Vec::new();
        let deck = get_highest_evolutions(&pokemon.card, &state.decks[attacker].cards);
        for evolution in deck.into_iter().chain(get_highest_evolutions(&pokemon.card, &state.hands[attacker])) {
            let Card::Pokemon(evolved) = &evolution else { continue };
            if stage(&evolution) <= stage(&pokemon.card) || seen.contains(&evolved.id) {
                continue;
            }
            seen.push(evolved.id.clone());
            out.push((slot, Some(evolution)));
        }
    }
    out
}

/// Hits to take the points left: the Active first, then the Benched Pokémon the defender would rather lose last (the
/// most hits per point; with one point to go, the most hits). `None` when one of them cannot be hurt.
fn hits_to_win(targets: &[Target], damage: &[f64], points: u8) -> Option<f64> {
    let hits = |at: usize| -> Option<f64> {
        if targets[at].hp <= 0.0 {
            Some(0.0)
        } else if damage[at] <= 0.0 {
            None
        } else {
            Some((targets[at].hp / damage[at]).ceil())
        }
    };
    let mut points = points;
    let mut total = 0.0;
    let mut bench: Vec<usize> = Vec::new();
    for at in 0..targets.len() {
        if targets[at].slot == 0 {
            total += hits(at)?;
            points += targets[at].points;
        } else {
            bench.push(at);
        }
    }
    while points < 3 && !bench.is_empty() {
        let cost = |at: usize| match hits(at) {
            None => f64::INFINITY,
            Some(h) if points == 2 => h,
            Some(h) => h / f64::from(targets[at].points.max(1)),
        };
        let mut pick = 0;
        for k in 1..bench.len() {
            if cost(bench[k]) >= cost(bench[pick]) {
                pick = k;
            }
        }
        let at = bench.swap_remove(pick);
        total += hits(at)?;
        points += targets[at].points;
    }
    Some(total)
}

/// The damage already on its way to `player`'s Pokémon at `slot`: Cursed Prose's (a `DelayedDamage` on it), a
/// delayed hit on its spot, poison and burn for a round.
fn pending_damage(state: &State, player: usize, slot: usize) -> f64 {
    let Some(pokemon) = state.in_play_pokemon[player][slot].as_ref() else { return 0.0 };
    let details = pokemon.public_details();
    let mut pending = 0.0;
    for (effect, _) in &details.effects {
        if let CardEffect::DelayedDamage { amount } = effect {
            pending += *amount as f64;
        }
    }
    // deckgym keeps a delayed hit on a spot (Meowscarada ex's Flower Trick) in this turn and the next, lands it at the
    // end of its target's turn and never removes the old entries: it is due once, from this turn's entry when the
    // target is the player whose turn it is, else from the next turn's (review of #117).
    let turn = state.turn_count;
    for (at, targets_this_turn) in [(turn, true), (turn.saturating_add(1), false)] {
        for effect in state.public_turn_effects().get(&at).into_iter().flatten() {
            if let TurnEffect::DelayedSpotDamage { target_player, target_in_play_idx, amount, .. } = effect {
                let due = (*target_player == state.current_player) == targets_this_turn;
                if *target_player == player && *target_in_play_idx == slot && due {
                    pending += *amount as f64;
                }
            }
        }
    }
    if pokemon.is_poisoned() {
        pending += 2.0 * details.poison_damage as f64;
    }
    if pokemon.is_burned() {
        pending += BURN_ROUND;
    }
    pending
}

/// Energy a Pokémon's own attacks attach to itself in a turn (the most of them; half of it on a coin).
fn self_charge(card: &Card) -> f64 {
    let Card::Pokemon(pokemon) = card else { return 0.0 };
    pokemon
        .attacks
        .iter()
        .map(|attack| match mechanic(attack) {
            Some(Mechanic::SelfChargeActive { energies }) => energies.len() as f64,
            Some(Mechanic::CoinFlipSelfChargeActive { energies }) => energies.len() as f64 / 2.0,
            _ => 0.0,
        })
        .fold(0.0, f64::max)
}

/// Energy an attack discards from the attacker, and the chance it does (a coin: ½). «All» is at least its cost: it
/// attacks with it.
fn self_discard(attack: &Attack, attached: &[EnergyType], cost: &[EnergyType]) -> (f64, f64) {
    let all = attached.len().max(cost.len()) as f64;
    let of = |types: &[EnergyType]| attached.iter().filter(|energy| types.contains(energy)).count() as f64;
    let discard = match mechanic(attack) {
        Some(
            Mechanic::SelfDiscardAllEnergy
            | Mechanic::SelfDiscardAllEnergyAndKnockOutOpponentActive
            | Mechanic::SelfDiscardAllEnergyAndInflictStatus { .. }
            | Mechanic::SelfDiscardAllEnergyAndDelayedSpotKnockOut,
        ) => all,
        Some(
            Mechanic::SelfDiscardAllTypeEnergy { energy_type }
            | Mechanic::SelfDiscardAllTypeEnergyAndDamageAnyOpponentPokemon { energy_type, .. },
        ) => of(std::slice::from_ref(energy_type)),
        Some(Mechanic::SelfDiscardAllTypesEnergyDamagePerDiscarded { energy_types, .. }) => of(energy_types),
        Some(
            Mechanic::SelfDiscardEnergy { energies }
            | Mechanic::SelfDiscardEnergyAndInflictStatus { energies, .. }
            | Mechanic::SelfDiscardEnergyAndCardEffect { energies, .. }
            | Mechanic::SelfDiscardEnergyAndDamageAnyOpponentPokemon { energies, .. }
            | Mechanic::SelfDiscardEnergyAndDamageAllOpponentPokemon { energies, .. }
            | Mechanic::SelfDiscardEnergyAndChoiceBenchDamage { energies, .. },
        ) => energies.len() as f64,
        Some(
            Mechanic::SelfDiscardRandomEnergy { count }
            | Mechanic::SelfDiscardRandomEnergyAndCardEffect { count, .. }
            | Mechanic::SelfDiscardRandomEnergyAndBenchDamage { count, .. },
        ) => *count as f64,
        Some(Mechanic::CoinFlipSelfDiscardRandomEnergy { count }) => return (*count as f64, 0.5),
        _ => 0.0,
    };
    (discard, 1.0)
}

fn mechanic(attack: &Attack) -> Option<&'static Mechanic> {
    EFFECT_MECHANIC_MAP.get(attack.effect.as_deref()?)
}

fn stage(card: &Card) -> u8 {
    match card {
        Card::Pokemon(pokemon) => pokemon.stage,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deckgym::card_ids::CardId;
    use deckgym::database::get_card_by_enum;
    use deckgym::models::StatusCondition;
    use deckgym::players::{create_players as deckgym_players, PlayerCode};
    use deckgym::state::PlayedCard;
    use deckgym::{Deck, Game};
    use EnergyType::{Lightning, Psychic};

    // Decks 16, 23 and 40 of docs/context/mazos_40_listas.md, the three blind spots of Infra's report (14/10).
    const DEDENNE: &str = "Energy: Lightning\n2 Dedenne ex B3b 24\n1 Indeedee ex B1 121\n1 Oricorio A3 165\n1 Zeraora A3a 21\n1 Skull Fossil A2 144\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n1 Cyrus A2 150\n2 Giant Cape A2 147\n2 Small Balloon B3b 64\n1 Clear Veil B4 149\n1 Protective Poncho B2 147\n1 Starting Plains B2 154\n";
    const MISMAGIUS: &str = "Energy: Psychic\n2 Latias A4a 36\n2 Latios A4a 37\n1 Misdreavus A4a 32\n1 Misdreavus A2 66\n2 Mismagius A4a 33\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n1 Pokémon Center Lady A2b 70\n1 Sabrina A1 225\n1 Red Card P-A 6\n2 Rocky Helmet A2 148\n1 Giant Cape A2 147\n";
    const VENUSAUR: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64\n";

    fn card(id: &str) -> PlayedCard {
        PlayedCard::from_id(CardId::from_card_id(id).expect(id))
    }

    fn tool(id: &str) -> Card {
        get_card_by_enum(CardId::from_card_id(id).expect(id))
    }

    fn first_attack(pokemon: &PlayedCard) -> Attack {
        match &pokemon.card {
            Card::Pokemon(card) => card.attacks[0].clone(),
            _ => panic!("not a Pokémon"),
        }
    }

    /// Player 0 with `deck_a` and `mine` in play, player 1 with `deck_b` and `theirs`, past the setup: whole decks
    /// (for the evolutions), empty hands, no points, player 0's turn.
    fn board(deck_a: &str, deck_b: &str, mine: Vec<PlayedCard>, theirs: Vec<PlayedCard>) -> State {
        let decks = [Deck::from_string(deck_a).expect("deck"), Deck::from_string(deck_b).expect("deck")];
        let players = deckgym_players(decks[0].clone(), decks[1].clone(), vec![PlayerCode::R, PlayerCode::R]);
        let mut game = Game::new(players, 7);
        game.play_until_stable();
        let mut state = game.get_state_clone();
        state.set_board(mine, theirs);
        state.decks = decks;
        state.hands = [Vec::new(), Vec::new()];
        state.points = [0, 0];
        state.current_player = 0;
        state
    }

    fn turns(state: &State, attacker: usize, see_evolutions: bool) -> f64 {
        let mut probe = state.clone();
        let turns = turns_to_win(&mut probe, attacker, see_evolutions, &GParams::default());
        assert!(probe == *state, "turns_to_win must leave the copy as it was");
        turns
    }

    #[test]
    fn dede_circuit_does_40_for_each_tool_in_play() {
        let dedenne = card("B3b 024").with_energy(vec![Lightning, Lightning]);
        // f reads its fixed damage: 40, with or without Tools.
        assert_eq!(crate::fair_bot::attack_damage(&first_attack(&dedenne)), 40);
        for tools in 0..=4 {
            let mut mine = vec![dedenne.clone(), card("A3a 021"), card("A3 165"), card("B3b 024")];
            for pokemon in mine.iter_mut().take(tools) {
                pokemon.attached_tools = vec![tool("A2 147")];
            }
            let mut probe = board(DEDENNE, MISMAGIUS, mine, vec![card("A4a 037")]);
            let damage = damage_against(&mut probe, 0, &first_attack(&dedenne), 0, 0.0);
            assert_eq!(damage, 40.0 * tools as f64, "{tools} Tools");
        }
    }

    #[test]
    fn a_tool_on_the_bench_brings_dedenne_closer_to_winning() {
        let dedenne = card("B3b 024").with_energy(vec![Lightning, Lightning]).with_tool(tool("A2 147"));
        let without = board(DEDENNE, MISMAGIUS, vec![dedenne.clone(), card("A3a 021")], vec![card("A4a 037"), card("A4a 036")]);
        let with = board(
            DEDENNE,
            MISMAGIUS,
            vec![dedenne, card("A3a 021").with_tool(tool("A2 147"))],
            vec![card("A4a 037"), card("A4a 036")],
        );
        assert!(turns(&with, 0, true) < turns(&without, 0, true), "{} vs {}", turns(&with, 0, true), turns(&without, 0, true));
        // f's clock reads 40 either way: the Tool on the Bench changes nothing for it.
        assert_eq!(crate::fair_bot::turns_to_win(&with, 0, true), crate::fair_bot::turns_to_win(&without, 0, true));
    }

    #[test]
    fn crossing_flights_counts_latios_on_the_bench_on_either_turn() {
        let latias = card("A4a 036").with_energy(vec![Psychic]);
        let alone = board(DEDENNE, MISMAGIUS, vec![card("B3b 024")], vec![latias.clone()]);
        let with_latios = board(DEDENNE, MISMAGIUS, vec![card("B3b 024")], vec![latias.clone(), card("A4a 037")]);
        let attack = first_attack(&latias);
        for (state, expected) in [(alone, 20.0), (with_latios, 40.0)] {
            let mut probe = state.clone();
            probe.current_player = 1;
            assert_eq!(damage_against(&mut probe, 1, &attack, 0, 0.0), expected);
            // turns_to_win gives the attacker its turn: with no turn effects, the same on player 0's turn as on player 1's.
            let mut theirs = state.clone();
            theirs.current_player = 1;
            assert_eq!(turns(&state, 1, false), turns(&theirs, 1, false));
        }
    }

    #[test]
    fn safeguard_walls_an_ex() {
        let dedenne = card("B3b 024").with_energy(vec![Lightning, Lightning]).with_tool(tool("A2 147"));
        let oricorio = board(DEDENNE, MISMAGIUS, vec![dedenne.clone()], vec![card("A3 165")]);
        assert_eq!(turns(&oricorio, 0, false), NO_THREAT);
        let latios = board(DEDENNE, MISMAGIUS, vec![dedenne], vec![card("A4a 037")]);
        assert!(turns(&latios, 0, false) < NO_THREAT);
    }

    #[test]
    fn cursed_prose_counts_before_it_lands() {
        let mismagius = card("A4a 033").with_energy(vec![Psychic]);
        let mut state = board(DEDENNE, MISMAGIUS, vec![card("B3b 024")], vec![mismagius.clone()]);
        state.current_player = 1;
        let before = turns(&state, 1, false);
        let mut game = Game::from_state(state.clone(), Vec::new(), 3);
        game.apply_action(&deckgym::actions::Action {
            actor: 1,
            action: deckgym::actions::SimpleAction::Attack(first_attack(&mismagius)),
            is_stack: false,
        });
        let after = game.get_state_clone();
        // The 90 has not landed, but it is on its way.
        assert_eq!(after.in_play_pokemon[0][0].as_ref().expect("Dedenne ex").get_remaining_hp(), 120);
        assert_eq!(pending_damage(&after, 0, 0), 90.0);
        assert!(turns(&after, 1, false) < before, "{} vs {before}", turns(&after, 1, false));
    }

    #[test]
    fn a_delayed_hit_on_a_spot_counts_once_and_not_after_it_lands() {
        use deckgym::actions::{Action, SimpleAction};
        // Review of #117: Flower Trick schedules 70 on a spot; deckgym keeps it in this turn and the next, and never
        // removes the old entries. It is due once (70, not 140), still due on the target's turn, and gone after.
        let state = board(DEDENNE, MISMAGIUS, vec![card("B3b 024")], vec![card("A4a 037")]);
        let mut game = Game::from_state(state, Vec::new(), 9);
        let act = |game: &mut Game, actor: usize, action: SimpleAction| {
            game.apply_action(&Action { actor, action, is_stack: false });
        };
        act(&mut game, 0, SimpleAction::ScheduleDelayedSpotDamage { target_player: 1, target_in_play_idx: 0, amount: 70 });
        assert_eq!(pending_damage(&game.get_state_clone(), 1, 0), 70.0);
        // The rival's turn: still on its way.
        act(&mut game, 0, SimpleAction::EndTurn);
        let theirs = game.get_state_clone();
        assert_eq!(theirs.current_player, 1);
        assert_eq!(pending_damage(&theirs, 1, 0), 70.0);
        // It lands at the end of that turn, and then nothing is pending.
        while game.get_state_clone().current_player == 1 {
            let state = game.get_state_clone();
            let (actor, actions) = state.generate_possible_actions();
            let end = actions.iter().find(|a| matches!(a.action, SimpleAction::EndTurn)).unwrap_or(&actions[0]).clone();
            assert_eq!(actor, end.actor);
            game.apply_action(&end);
        }
        let after = game.get_state_clone();
        assert_eq!(after.in_play_pokemon[1][0].as_ref().expect("Latios").get_remaining_hp(), 110 - 70);
        assert_eq!(pending_damage(&after, 1, 0), 0.0);
    }

    #[test]
    fn poison_and_burn_come_off_the_hp() {
        let mut state = board(DEDENNE, MISMAGIUS, vec![card("B3b 024")], vec![card("A4a 037")]);
        assert_eq!(pending_damage(&state, 1, 0), 0.0);
        state.apply_status_condition(1, 0, StatusCondition::Poisoned);
        assert_eq!(pending_damage(&state, 1, 0), 20.0);
        state.apply_status_condition(1, 0, StatusCondition::Burned);
        assert_eq!(pending_damage(&state, 1, 0), 20.0 + BURN_ROUND);
    }

    #[test]
    fn luster_purge_hits_every_three_turns() {
        let latios = card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic]);
        let attack = first_attack(&latios);
        assert_eq!(self_discard(&attack, &latios.attached_energy, &attack.energy_required), (3.0, 1.0));
        // Two Dedenne ex (2 points each), one Luster Purge each: the second waits for 3 Energy again.
        let state = board(MISMAGIUS, DEDENNE, vec![latios], vec![card("B3b 024"), card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 2.0 + 2.0);
    }

    #[test]
    fn synthesis_makes_mega_venusaur_ready_sooner() {
        let ivysaur = card("B1a 002");
        assert_eq!(self_charge(&ivysaur.card), 2.0);
        let bulbasaur = board(VENUSAUR, DEDENNE, vec![card("A1 001")], vec![card("B3b 024")]);
        let ivysaur = board(VENUSAUR, DEDENNE, vec![ivysaur], vec![card("B3b 024")]);
        // Bulbasaur: Vine Whip (2 Energy, 3 hits) or Mega Venusaur ex (4 Energy at one a turn): 5 turns. Ivysaur: Mega
        // Venusaur ex with 3 Energy a turn (Synthesis and the zone): 2 turns, then Critical Bloom's 120 and its poison.
        assert_eq!(turns(&bulbasaur, 0, true), 5.0);
        assert_eq!(turns(&ivysaur, 0, true), 3.0);
        // f's clock sees no gain in evolving into Ivysaur there.
        assert_eq!(crate::fair_bot::turns_to_win(&bulbasaur, 0, true), crate::fair_bot::turns_to_win(&ivysaur, 0, true));
    }

    #[test]
    fn damage_is_counted_once_the_attack_is_ready() {
        use EnergyType::{Fire, Grass};
        assert_eq!(energy_to_attack(&[], &[Fire, Lightning], &[Fire, Lightning], Some(EnergyType::Colorless)), vec![Fire, Lightning]);
        assert_eq!(energy_to_attack(&[Grass], &[Grass, EnergyType::Colorless], &[Grass], Some(Grass)), vec![Grass]);
        assert_eq!(energy_to_attack(&[Grass, Grass], &[Grass, EnergyType::Colorless], &[Grass], Some(Grass)), Vec::<EnergyType>::new());
        // Mega Rayquaza ex with no Energy: Mega Burst does 50 for each Energy it discards, so 100 once its [R][L] are
        // on (the engine says 0 on the board as it is). Against a Dedenne ex (120 HP): 2 hits, then it waits for its
        // 2 Energy again: 2 turns to get ready, 1 + 2 to hit twice.
        let rayquaza = "Energy: Fire, Lightning\n2 Dratini A1 183\n2 Dragonair B4 117\n2 X B3a 54\n1 Mega Rayquaza ex B4 120\n2 Professor's Research P-A 7\n2 Copycat B1 225\n1 Pokémon Center Lady A2b 70\n1 X B3a 72\n1 Cyrus A2 150\n2 Poké Ball P-A 5\n1 X B3a 69\n2 X B4 155\n1 X B2b 69\n";
        let state = board(rayquaza, DEDENNE, vec![card("B4 120")], vec![card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 2.0 + 1.0 + 2.0);
    }

    #[test]
    fn an_asleep_or_paralyzed_active_loses_its_turn() {
        let latios = card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic]);
        let awake = board(MISMAGIUS, DEDENNE, vec![latios], vec![card("B3b 024")]);
        let mut asleep = awake.clone();
        asleep.apply_status_condition(0, 0, StatusCondition::Asleep);
        let mut paralyzed = awake.clone();
        paralyzed.apply_status_condition(0, 0, StatusCondition::Paralyzed);
        assert_eq!(turns(&asleep, 0, false), turns(&awake, 0, false) + ASLEEP_TURNS);
        assert_eq!(turns(&paralyzed, 0, false), turns(&awake, 0, false) + 1.0);
    }

    #[test]
    fn a_benched_attacker_waits_for_the_active_to_retreat() {
        let latios = card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic]);
        // Misdreavus (retreat 1) with no Energy: one more turn to get Latios in; with its Energy, none.
        let stuck = board(MISMAGIUS, DEDENNE, vec![card("A2 066"), latios.clone()], vec![card("B3b 024")]);
        let free = board(MISMAGIUS, DEDENNE, vec![card("A2 066").with_energy(vec![Psychic]), latios], vec![card("B3b 024")]);
        assert_eq!(turns(&stuck, 0, false), turns(&free, 0, false) + 1.0);
    }

    #[test]
    fn g2_evolves_where_e2_does_not_and_repeats_with_the_seed() {
        let run = |bot: &str| {
            crate::simulate(crate::SimulateJob {
                deck_a: VENUSAUR.to_string(),
                deck_b: crate::coach::tests::ALTARIA.to_string(),
                players: vec![bot.to_string(), bot.to_string()],
                games: 12,
                seed: 20261014,
                threads: 2,
                replay_sample: 0,
                replay_dir: None,
                per_game: true,
                checkpoint: None,
            })
            .expect("simulate")
            .per_game
            .expect("perGame")
        };
        assert!(run("e2").stages_a.chars().all(|c| c == '0'), "{}", run("e2").stages_a);
        let g2 = run("g2");
        assert!(g2.stages_a.contains('2'), "{}", g2.stages_a);
        assert_eq!(g2.winners, run("g2").winners);
    }

    // Three lists of the meta bank of B4a (lab_meta_bank, 15/10/2026), with the cards named by their code.
    const LUCARIO: &str = "Energy: Fighting\n2 Riolu A2 91\n2 Mega Lucario ex B3 81\n1 Lucario A2 92\n1 Bonsly B3 78\n1 Hitmonlee A1 154\n2 Professor's Research P-A 7\n1 Copycat B1 225\n1 X B3 149\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n2 Poké Ball P-A 5\n2 Lucky Ice Pop B2 145\n1 Field Blower B3 147\n1 X Speed P-A 2\n1 X B3 154\n";
    const SUICUNE: &str = "Energy: Water\n2 Frigibax B2a 34\n2 Baxcalibur B2a 36\n2 Suicune ex A4a 20\n1 Chien-Pao ex B2a 37\n2 Copycat B1 225\n2 Professor's Research P-A 7\n1 Pokémon Center Lady A2b 70\n2 Poké Ball P-A 5\n2 Rare Candy A3 144\n2 Giant Cape A2 147\n1 Inflatable Boat A4a 67\n1 X B4 154\n";
    const HYDREIGON: &str = "Energy: Darkness\n2 Deino B1 155\n2 Hydreigon B1 157\n1 Mega Absol ex B1 151\n1 Bombirdier B3 115\n2 Copycat B1 225\n2 Professor's Research P-A 7\n1 Sabrina A1 225\n1 Cyrus A2 150\n2 Rare Candy A3 144\n2 Poké Ball P-A 5\n2 Lucky Ice Pop B2 145\n2 X B4 148\n";

    /// docs/BOTS.md, «contra la partida»: on boards of real games, the expected damage of every attack with a single
    /// outcome is what playing it does to the rival's Active. Boards with poison or burn on it are left out (the
    /// Checkup after the attack would add its damage), and so are attacks that ask for a choice before hitting.
    #[test]
    fn expected_damage_is_what_the_attack_does() {
        use deckgym::actions::{forecast_action, SimpleAction};
        let decks = [DEDENNE, MISMAGIUS, VENUSAUR, LUCARIO, SUICUNE, HYDREIGON, crate::coach::tests::ALTARIA];
        let mut checked = 0;
        let mut differ: Vec<String> = Vec::new();
        for (a, b) in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 0), (3, 5), (4, 6)] {
            for seed in 0..4 {
                let deck = |at: usize| Deck::from_string(decks[at]).expect("deck");
                let mut game = Game::new(deckgym_players(deck(a), deck(b), vec![PlayerCode::R, PlayerCode::R]), seed);
                let mut ticks = 0;
                while !game.is_game_over() && ticks < 400 {
                    ticks += 1;
                    let state = game.get_state_clone();
                    let (actor, actions) = state.generate_possible_actions();
                    let defender = (actor + 1) % 2;
                    for action in &actions {
                        let SimpleAction::Attack(attack) = &action.action else { continue };
                        let Some(target) = state.in_play_pokemon[defender][0].as_ref() else { continue };
                        if action.is_stack || target.is_poisoned() || target.is_burned() || forecast_action(&state, action).len() != 1 {
                            continue;
                        }
                        let before = target.get_remaining_hp();
                        let expected = expected_attack_damage(&state, actor, attack, defender, 0).min(before as f64);
                        let mut played = Game::from_state(state.clone(), Vec::new(), 1);
                        played.apply_action(action);
                        let after = played.get_state_clone();
                        if !after.move_generation_stack.is_empty() {
                            continue;
                        }
                        let knocked_out = after.points[actor] > state.points[actor];
                        let done = if knocked_out {
                            before
                        } else {
                            before - after.in_play_pokemon[defender][0].as_ref().map_or(before, |p| p.get_remaining_hp())
                        };
                        checked += 1;
                        if (expected - done as f64).abs() > 1e-9 {
                            differ.push(format!("{} ({:?}) → {}: expected {expected}, did {done}", attack.title, attack.effect, target.get_name()));
                        }
                    }
                    game.play_tick();
                }
            }
        }
        differ.sort();
        differ.dedup();
        assert!(checked > 200, "only {checked} attacks checked");
        assert!(differ.is_empty(), "{} of {checked} differ:\n{}", differ.len(), differ.join("\n"));
    }

    #[test]
    fn the_retreat_is_counted_on_the_attackers_turn() {
        // Self-review: Latios (no Energy) retreats for free with Latias in play, but deckgym reads that ability on the
        // turn's player. Read on the rival's turn, Latios' retreat cost 2 and Latias waited a turn more.
        let mine = vec![card("A4a 037"), card("A4a 036").with_energy(vec![Psychic])];
        let state = board(MISMAGIUS, DEDENNE, mine, vec![card("B3b 024")]);
        let mut theirs = state.clone();
        theirs.current_player = 1;
        assert_eq!(turns(&theirs, 0, false), turns(&state, 0, false));
    }

    #[test]
    fn an_attack_that_also_picks_a_benched_pokemon_still_hits_the_active() {
        let hoopa = card("B4 103").with_energy(vec![EnergyType::Darkness]);
        let attack = first_attack(&hoopa);
        let alone = board(DEDENNE, DEDENNE, vec![hoopa.clone()], vec![card("B3b 024")]);
        let benched = board(DEDENNE, DEDENNE, vec![hoopa], vec![card("B3b 024"), card("A3a 021")]);
        // Shadow Bullet: 30 to the Active, then 20 to a Benched Pokémon of the attacker's choice. With a Bench the
        // engine holds all of it until the choice, and said 0.
        assert_eq!(damage_against(&mut alone.clone(), 0, &attack, 0, 0.0), 30.0);
        let mut probe = benched.clone();
        assert_eq!(damage_against(&mut probe, 0, &attack, 0, 0.0), 30.0);
        assert!(probe == benched);
    }

    #[test]
    fn this_turns_effects_do_not_count_for_the_rival() {
        use deckgym::actions::{Action, SimpleAction};
        // Giovanni: +10 for player 0's attacks this turn. The rival's clock (its Latias against Dedenne ex) is the
        // same before and after; player 0's own does count it.
        let Card::Trainer(giovanni) = tool("A1 223") else { panic!("Giovanni") };
        let mine = vec![card("B3b 024").with_energy(vec![Lightning, Lightning]).with_tool(tool("A2 147"))];
        let mut state = board(DEDENNE, MISMAGIUS, mine, vec![card("A4a 036").with_energy(vec![Psychic])]);
        state.hands[0].push(Card::Trainer(giovanni.clone()));
        let mut game = Game::from_state(state.clone(), Vec::new(), 5);
        game.apply_action(&Action { actor: 0, action: SimpleAction::Play { trainer_card: giovanni }, is_stack: false });
        let played = game.get_state_clone();
        assert_eq!(turns(&played, 1, false), turns(&state, 1, false));
        let mut probe = played.clone();
        let dede_circuit = first_attack(played.in_play_pokemon[0][0].as_ref().expect("Dedenne ex"));
        assert_eq!(damage_against(&mut probe, 0, &dede_circuit, 0, 0.0), 50.0);
    }

    #[test]
    fn toxic_and_pierce_the_pain_are_read_by_their_mechanic() {
        let toxicroak = card("A2a 052").with_energy(vec![EnergyType::Darkness]);
        let decidueye = card("A3 012").with_energy(vec![EnergyType::Grass, EnergyType::Grass]);
        let target = |damage: u32| board(DEDENNE, DEDENNE, vec![toxicroak.clone(), decidueye.clone()], vec![card("B3b 024").with_damage(damage)]);
        // Toxic does no damage: its poison is 20 at each Checkup, 40 a round (f read «20 damage» as a hit).
        assert_eq!(crate::fair_bot::attack_damage(&first_attack(&toxicroak)), 20);
        assert_eq!(damage_against(&mut target(0), 0, &first_attack(&toxicroak), 0, 0.0), 40.0);
        assert_eq!(damage_against(&mut target(0), 0, &first_attack(&toxicroak), 0, 40.0), 0.0);
        // Pierce the Pain: 100 to a Pokémon with damage on it; none to one without.
        let mut probe = target(10);
        probe.in_play_pokemon[0].swap(0, 1);
        assert_eq!(damage_against(&mut probe, 0, &first_attack(&decidueye), 0, 0.0), 100.0);
        let mut probe = target(0);
        probe.in_play_pokemon[0].swap(0, 1);
        assert_eq!(damage_against(&mut probe, 0, &first_attack(&decidueye), 0, 0.0), 0.0);
    }

    #[test]
    fn what_the_rival_hides_does_not_change_the_evaluation() {
        // Porygon-Z's Cyberjack does 20 more for each Trainer in its rival's deck; Lillipup's Puppy Pile, 20 for each
        // Lillipup in play or in its owner's hand. Two boards alike in everything public: the rival's (player 1's)
        // deck and hand differ in what they are, not in how many.
        let porygon = card("B1a 058").with_energy(vec![EnergyType::Colorless; 3]);
        let mut state = board(DEDENNE, DEDENNE, vec![porygon], vec![card("B3 137"), card("B3 137")]);
        let lillipup = || match PlayedCard::from_id(CardId::from_card_id("B3 137").expect("id")).card {
            card @ Card::Pokemon(_) => card,
            _ => panic!("Lillipup"),
        };
        state.hands[1] = vec![tool("A2 147"), tool("A2 147")];
        let mut other = state.clone();
        other.hands[1] = vec![lillipup(), lillipup()];
        for card in other.decks[1].cards.iter_mut().filter(|c| matches!(c, Card::Trainer(_))) {
            *card = lillipup();
        }
        assert_eq!(other.decks[1].cards.len(), state.decks[1].cards.len());
        // On the boards as they are, Cyberjack reads the rival's deck: the leak this guards against.
        let cyberjack = first_attack(state.in_play_pokemon[0][0].as_ref().expect("Porygon-Z"));
        let seen = |board: &State| damage_against(&mut board.clone(), 0, &cyberjack, 0, 0.0);
        assert_ne!(seen(&state), seen(&other));
        assert_eq!(seen(&hide_then(&state, 1)), seen(&hide_then(&other, 1)));
        let params = GParams::default();
        assert_eq!(g_value_function(&state, 0, &params), g_value_function(&other, 0, &params));
        assert_ne!(
            turns_to_win(&mut state.clone(), 0, true, &params),
            turns_to_win(&mut other.clone(), 0, true, &params),
            "the boards must differ where it matters"
        );
        // What g's own side holds still counts: its own hand is not hidden from it.
        let mut mine = state.clone();
        mine.hands[0] = vec![lillipup()];
        assert_eq!(hide_then(&mine, 1).hands[0], mine.hands[0]);
    }

    fn hide_then(state: &State, rival: usize) -> State {
        let mut copy = state.clone();
        hide(&mut copy, rival);
        copy
    }

    #[test]
    fn poison_on_the_target_keeps_falling_every_round() {
        // Self-review of #117 (Codex): a Poisoned Dedenne ex (120 HP) takes 20 a round until it is knocked out. Latias'
        // 20 a hit plus 20 of poison a round: 120 − 20 pending = 100, at 40 a round, 3 rounds (not 100 / 20 = 5).
        let latias = card("A4a 036").with_energy(vec![Psychic]);
        let mut state = board(MISMAGIUS, DEDENNE, vec![latias.clone()], vec![card("B3b 024")]);
        state.apply_status_condition(1, 0, StatusCondition::Poisoned);
        assert_eq!(turns(&state, 0, false), 3.0);
        assert_eq!(damage_against(&mut state.clone(), 0, &first_attack(&latias), 0, 20.0), 40.0);
        // An attack that does nothing does not borrow the poison as its own hit.
        let ivysaur = card("B1a 002").with_energy(vec![EnergyType::Grass]);
        assert_eq!(damage_against(&mut state.clone(), 0, &first_attack(&ivysaur), 0, 20.0), 0.0);
    }

    #[test]
    fn a_status_locked_active_holds_back_a_benched_attacker() {
        // Self-review of #117 (Codex): an Asleep or Paralyzed Active cannot retreat either.
        let mine = vec![card("A2 066").with_energy(vec![Psychic]), card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic])];
        let awake = board(MISMAGIUS, DEDENNE, mine, vec![card("B3b 024")]);
        let mut paralyzed = awake.clone();
        paralyzed.apply_status_condition(0, 0, StatusCondition::Paralyzed);
        let mut asleep = awake.clone();
        asleep.apply_status_condition(0, 0, StatusCondition::Asleep);
        assert_eq!(turns(&paralyzed, 0, false), turns(&awake, 0, false) + 1.0);
        assert_eq!(turns(&asleep, 0, false), turns(&awake, 0, false) + ASLEEP_TURNS);
    }

    #[test]
    fn a_coin_flip_discard_waits_on_average_after_rounding() {
        use EnergyType::Fire;
        // Self-review of #117 (Codex): Entei's Strong Flare (110, «Flip a coin. If tails, discard 2 random Energy»):
        // the next hit is 1 turn away on heads and 2 on tails, 1.5 on average (halving before rounding gave 1, no
        // wait at all). Against two Dedenne ex (120 HP, 2 points each): 2 hits each, 4 hits, 3 waits of 1.5.
        let entei = card("A4 033").with_energy(vec![Fire; 4]);
        let (discard, chance) = self_discard(&first_attack(&entei), &entei.attached_energy, &first_attack(&entei).energy_required);
        assert_eq!((discard, chance), (2.0, 0.5));
        let fire = "Energy: Fire\n2 Entei A4 33\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n2 Giant Cape A2 147\n2 Rocky Helmet A2 148\n2 Lucky Ice Pop B2 145\n2 Cyrus A2 150\n2 Sabrina A1 225\n2 Red Card P-A 6\n";
        let state = board(fire, DEDENNE, vec![entei], vec![card("B3b 024"), card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 4.0 + 3.0 * 0.5);
    }

    #[test]
    fn codes() {
        use crate::fair_bot::{parse_bot_code, BotCode};
        assert!(matches!(parse_bot_code("g2"), Ok(BotCode::G { max_depth: 2 })));
        assert!(matches!(parse_bot_code("G3"), Ok(BotCode::G { max_depth: 3 })));
        assert!(parse_bot_code("g0").is_err());
        assert!(parse_bot_code("gx").is_err());
        assert!(crate::parse_players(&["g2".to_string(), "e2".to_string()]).is_ok());
    }
}

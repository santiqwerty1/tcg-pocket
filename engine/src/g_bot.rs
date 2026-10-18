//! «g<N>» (docs/BOTS.md, line 1 of the bots, 14/10/2026): deckgym's expectiminimax, like e and f, with an evaluation
//! whose damage comes from the engine itself. f's clock reads «N damage» out of a card's text and takes an attack's
//! `fixed_damage` as what it does; the engine knows better: Dede-Circuit does 40 for each Pokémon with a Tool (its
//! `fixed_damage` is 40 with none), Latias' Crossing Flights 20 more with Latios on the Bench, nothing against
//! Oricorio's Safeguard. g asks the engine (`expected_attack_damage`, an export of the fork, D-031) for the expected
//! damage of each attack against each Pokémon it can hit, and adds what the clock missed:
//! - damage already scheduled (Cursed Prose's 90, a knockout on a spot, burn) comes off the target's HP before counting
//!   hits, and poison falls a round after each hit; what an attack poisons or burns counts with its chance;
//! - an attack that charges its own Energy (Ivysaur's Synthesis) makes its line ready sooner, and one that does more
//!   with more Energy (Mega Burst) may wait for it;
//! - an attack that discards its Energy (Latios' Luster Purge) or cannot be used next turn can only hit every so many
//!   turns, one that hurts its user only as many times as it survives, and one that hits the whole Bench wears it
//!   down with the Active;
//! - a Benched attacker waits for the Active to retreat, and an Asleep or Paralyzed Active loses its turn.
//!
//! A leaf in the middle of its own turn is worth at least attacking right away (g 1.1: with depth 2 a Tool left the
//! attack past the leaf). Only what a player sees: the board, the Energy Zones, the own deck list and hand; the
//! rival's hand and deck are unknown cards on the copy it evaluates (`hide`), so neither its evolutions nor an attack
//! that counts them leak. The search is deckgym's, unchanged (it still sees the draws: line 2). deckgym is not changed
//! here, and no game of another bot changes.

use deckgym::actions::{expected_attack_damage, forecast_action, Action, Mechanic, SimpleAction, EFFECT_MECHANIC_MAP};
use deckgym::card_logic::get_highest_evolutions;
use deckgym::effects::{CardEffect, TurnEffect};
use deckgym::get_retreat_cost;
use deckgym::models::{Attack, Card, EnergyType, PokemonCard, StatusCondition, TrainerCard, TrainerType};
use deckgym::players::{parametric_value_function, ValueFunctionParams};
use deckgym::state::observation::knockout_points;
use deckgym::state::{has_serperior_jungle_totem, PlayedCard};
use deckgym::State;
use rand::rngs::StdRng;
use rand::SeedableRng;

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
    /// How much a hit's spare damage counts, in hits: knocking out with damage to spare ranks a little above just
    /// knocking out, so a Tool that adds damage without saving a whole hit still pays for the card it takes from the
    /// hand. Below 1/4, so over the four Pokémon of a side it never outweighs a whole hit.
    pub margin: f64,
    /// Whether a leaf in the middle of its own turn is also worth attacking right away (`g_value_function`).
    pub attack_now: bool,
}

impl Default for GParams {
    /// f's weights: deckgym's baseline with its clock replaced by g's.
    fn default() -> Self {
        let mut base = ValueFunctionParams::baseline();
        base.turns_until_opponent_wins = 0.0;
        GParams { base, clock: 100.0, pending: 1.0, margin: 0.1, attack_now: true }
    }
}

/// deckgym's value for «this side cannot hit at all» (f's too).
pub const NO_THREAT: f64 = 30.0;
/// Poison takes 10 at each Pokémon Checkup, and there is one at the end of every turn: 20 a round.
const POISON_ROUND: f64 = 20.0;
/// A burn does 20 at the next Checkup and, if the coin does not heal it, 20 at the one after.
const BURN_ROUND: f64 = 30.0;
/// What a burn does at one Checkup.
const BURN_CHECKUP: f64 = 20.0;
/// What a burn already on a Pokémon does from now on if nothing burns it again: 20 at each Checkup until a coin heals
/// it, ½ each time, 20 + 10 + 5 … = 40 (Codex on #128: a full round after every hit overstated it).
const BURN_LEFT: f64 = 40.0;
/// An Asleep Pokémon flips at every Checkup, so it is still Asleep at its owner's next turn with ½ when one Checkup
/// comes first and with ¼ when two do. On its owner's turn it loses this one and then ¼ of each next: 1 + ¼ + … = 4/3
/// turns (Codex on #117); on the rival's turn, ½ of that: 2/3.
const ASLEEP_TURNS_ON_ITS_TURN: f64 = 4.0 / 3.0;
const ASLEEP_TURNS_ON_THE_RIVALS: f64 = 2.0 / 3.0;

/// g's evaluation of `state` for `myself`. A leaf of the search in the middle of its own turn is worth at least what
/// attacking right away gives (`attack_now`): the search counts every decision, so with depth 2 a Tool (the card,
/// then the Pokémon) or a Supporter that asks for a choice leaves the attack past the leaf, while attacking first shows
/// its damage at once, and g played Dede-Circuit with Tools still in its hand (Dedenne, 18/10/2026). Attacking ends
/// the turn, so it is one step more and no deeper. The attack is applied as the search applies one, with a fixed seed
/// for what is random in it, on the copy with the rival's cards hidden: an attack that counts them (Cyberjack) sees
/// unknown cards there too. Then the turn ends, as the search ends it after an attack of its own: the Checkup and the
/// rival's draw come before the value, or the poison after the hit is missing and this turn's boosts count for every
/// later hit (review of g 1.1: Poison Ring went back to attacking before Giant Cape). A leaf with only the end of the
/// turn left (g1's attacks) is valued the same way.
pub fn g_value_function(state: &State, myself: usize, params: &GParams) -> f64 {
    let opponent = (myself + 1) % 2;
    // One copy per evaluation, with what `myself` cannot see hidden: the attackers and defenders take the Active spot
    // on it in turn, and deckgym's own terms are read from it too (its «Active ready» looks for evolutions in the deck
    // and hand of each side).
    let mut seen = state.clone();
    hide(&mut seen, opponent);
    let stand = evaluate(&mut seen, myself, params);
    if !params.attack_now || seen.current_player != myself || seen.winner.is_some() || !can_attack(&seen, myself) {
        return stand;
    }
    let (actor, actions) = seen.generate_possible_actions();
    if actor != myself {
        return stand;
    }
    let mut rng = StdRng::seed_from_u64(0);
    if let Some(end) = only_end_turn(&actions) {
        let end = end.clone();
        return after_end_turn(seen, &end, myself, params, &mut rng);
    }
    let mut best = stand;
    for action in actions.iter().filter(|action| matches!(action.action, SimpleAction::Attack(_))) {
        let (probabilities, mutations) = forecast_action(&seen, action).into_branches();
        let mut value = 0.0;
        for (probability, mutation) in probabilities.iter().zip(mutations) {
            let mut outcome = seen.clone();
            mutation(&mut rng, &mut outcome, action);
            value += probability * settle(outcome, myself, params, &mut rng, CHOICES_AFTER_AN_ATTACK);
        }
        best = best.max(value);
    }
    best
}

/// Choices an attack can still ask for that `settle` makes before ending the turn: Shadow Bullet's Benched target, and
/// one more after it.
const CHOICES_AFTER_AN_ATTACK: u8 = 2;

/// The value of what an attack left: its choice made the best way when it asks for one (Shadow Bullet's Benched
/// target: until then the engine holds back all its damage; Codex on #128), and then the end of the turn. After an
/// attack with no choice left, ending the turn is all there is (`after_an_attack_only_the_end_of_the_turn_is_left`). A
/// game the attack ends has no turn to end: deckgym's end of turn wants an Active on both sides. A choice of the rival
/// (its new Active after a knockout) is its own: the value is taken there.
fn settle(mut outcome: State, myself: usize, params: &GParams, rng: &mut StdRng, choices: u8) -> f64 {
    if outcome.winner.is_some() || outcome.current_player != myself {
        return evaluate(&mut outcome, myself, params);
    }
    if outcome.move_generation_stack.is_empty() {
        let end = Action { actor: myself, action: SimpleAction::EndTurn, is_stack: false };
        return after_end_turn(outcome, &end, myself, params, rng);
    }
    let (actor, actions) = outcome.generate_possible_actions();
    if actor != myself || choices == 0 || actions.is_empty() {
        return evaluate(&mut outcome, myself, params);
    }
    let mut best = f64::NEG_INFINITY;
    for choice in &actions {
        let (probabilities, mutations) = forecast_action(&outcome, choice).into_branches();
        let mut value = 0.0;
        for (probability, mutation) in probabilities.iter().zip(mutations) {
            let mut chosen = outcome.clone();
            mutation(rng, &mut chosen, choice);
            value += probability * settle(chosen, myself, params, rng, choices - 1);
        }
        best = best.max(value);
    }
    best
}

/// The end of the turn, when it is the only thing left to do.
fn only_end_turn(actions: &[Action]) -> Option<&Action> {
    match actions {
        [end] if matches!(end.action, SimpleAction::EndTurn) => Some(end),
        _ => None,
    }
}

/// The value of `seen` once `myself` ends its turn (`end`): each branch of the Checkup, with the rival's draw from its
/// hidden deck, so what it holds stays unknown.
fn after_end_turn(mut seen: State, end: &Action, myself: usize, params: &GParams, rng: &mut StdRng) -> f64 {
    let (probabilities, mut mutations) = forecast_action(&seen, end).into_branches();
    // Nearly always a single branch (no coin at the Checkup): then on `seen` itself, with no copy.
    if mutations.len() == 1 {
        let mutation = mutations.pop().expect("one branch");
        mutation(rng, &mut seen, end);
        return probabilities[0] * evaluate(&mut seen, myself, params);
    }
    let mut value = 0.0;
    for (probability, mutation) in probabilities.iter().zip(mutations) {
        let mut ended = seen.clone();
        mutation(rng, &mut ended, end);
        value += probability * evaluate(&mut ended, myself, params);
    }
    value
}

/// Whether `myself`'s Active has the Energy for one of its attacks and no status that stops it: most leaves cannot
/// attack at all, and generating their actions is not worth it there.
fn can_attack(state: &State, myself: usize) -> bool {
    let Some(active) = state.in_play_pokemon[myself][0].as_ref() else { return false };
    let Card::Pokemon(pokemon) = &active.card else { return false };
    if active.is_asleep() || active.is_paralyzed() {
        return false;
    }
    let attached = state.effective_attached_energy(myself, 0);
    pokemon.attacks.iter().any(|attack| missing_energy(&attached, &state.effective_attack_cost(myself, attack)) == 0)
}

/// g's evaluation of `probe` as it stands, with the rival's hand and deck already hidden; `probe` is left as it was.
fn evaluate(probe: &mut State, myself: usize, params: &GParams) -> f64 {
    let opponent = (myself + 1) % 2;
    let clock = turns_to_win(probe, opponent, false, params) - turns_to_win(probe, myself, true, params);
    parametric_value_function(probe, myself, &params.base) + clock * params.clock
}

/// Trainers in a list of the meta bank (lab_meta_bank B4a, 18/10/2026: 10 to 16 of 20, 12,4 by weight): what `hide`
/// takes the rival's 20 cards to hold.
const LIST_TRAINERS: usize = 12;
const LIST_POKEMON: usize = 8;

/// The rival's hand and deck as unknown cards, so far as `state` is a copy for the evaluation: how many there are is
/// public, what they are is not. An attack that counts them (Porygon-Z's Cyberjack, the Trainers in its rival's deck)
/// sees what a list of the bank would still have, given what the rival has shown: 12 Trainers and 8 Pokémon of 20, less
/// the ones in play and in its discard pile, spread over its hand and deck alike. Taking every unknown card for a
/// Trainer gave Cyberjack hundreds of damage that are not there (Codex on #117). The Energy Zone stays: it is public.
pub fn hide(state: &mut State, rival: usize) {
    // With no id and no name: every copy of the board copies them, and an empty text costs nothing to copy.
    let unknown_trainer = Card::Trainer(TrainerCard {
        id: String::new(),
        trainer_card_type: TrainerType::Item,
        name: String::new(),
        effect: String::new(),
        rarity: String::new(),
        booster_pack: String::new(),
    });
    // A Basic with no attack, no Ability and no evolution: nothing it does can be read, and it evolves into nothing.
    let unknown_pokemon = Card::Pokemon(PokemonCard {
        id: String::new(),
        name: String::new(),
        stage: 0,
        evolves_from: None,
        hp: 60,
        energy_type: EnergyType::Colorless,
        ability: None,
        attacks: Vec::new(),
        weakness: None,
        retreat_cost: Vec::new(),
        rarity: String::new(),
        booster_pack: String::new(),
    });
    let (trainers, pokemon) = shown(state, rival);
    let (trainers_left, pokemon_left) = (LIST_TRAINERS.saturating_sub(trainers), LIST_POKEMON.saturating_sub(pokemon));
    let left = trainers_left + pokemon_left;
    let share = |cards: usize| -> usize { (cards * trainers_left + left / 2).checked_div(left).unwrap_or(cards / 2) };
    // One split over the hand and the deck together, so the two never hold more Trainers than are left (Codex on #128).
    let (in_hand, in_deck) = (state.hands[rival].len(), state.decks[rival].cards.len());
    let trainers = share(in_hand + in_deck);
    let deck_trainers = trainers.saturating_sub(share(in_hand).min(trainers)).min(in_deck);
    for (cards, as_trainers) in [(&mut state.hands[rival], trainers - deck_trainers), (&mut state.decks[rival].cards, deck_trainers)] {
        for (at, card) in cards.iter_mut().enumerate() {
            *card = if at < as_trainers { unknown_trainer.clone() } else { unknown_pokemon.clone() };
        }
    }
}

/// The Trainers and the Pokémon of `rival`'s list it has shown: its discard pile and what it has in play, each card under
/// an evolution (`cards_behind`: Frigibax under a Baxcalibur that came with Rare Candy is one, not two) and each Tool.
/// A Fossil in play is a Trainer card (review of g 1.1).
fn shown(state: &State, rival: usize) -> (usize, usize) {
    let (mut trainers, mut pokemon) = (0, 0);
    let mut count = |card: &Card| match card {
        Card::Trainer(_) => trainers += 1,
        Card::Pokemon(_) => pokemon += 1,
    };
    state.discard_piles[rival].iter().for_each(&mut count);
    for in_play in state.in_play_pokemon[rival].iter().flatten() {
        count(&in_play.card);
        in_play.cards_behind.iter().for_each(&mut count);
        in_play.attached_tools.iter().for_each(&mut count);
    }
    (trainers, pokemon)
}

/// One Pokémon of the side being knocked out, as the clock sees it.
#[derive(Clone, Copy, Debug)]
struct Target {
    slot: usize,
    /// Remaining HP minus the damage already scheduled on it, and minus the poison it takes before the attacker's first
    /// hit (a Checkup, when the defender's own turn comes first).
    hp: f64,
    points: u8,
    /// The poison it takes in a round (both Checkups), 0 if it is not Poisoned: it keeps falling after every hit until
    /// the knockout.
    poison: f64,
    /// A burn on it: with an attack that burns it again, it takes `burn_before` before the first hit (a Checkup, when
    /// the defender's own turn comes first) and the attack's round after each; with any other, `BURN_LEFT` in all.
    burned: bool,
    burn_before: f64,
}

/// Energy more than an attack's cost the clock tries, for an attack that does more with it (Mega Burst, Codex on #117).
const MAX_OVERCHARGE: usize = 2;

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
            let poison = if pokemon.is_poisoned() { pokemon.public_details().poison_damage as f64 } else { 0.0 };
            let burned = pokemon.is_burned();
            // A KO at the Checkups right after a hit counts in that hit's turn: poison and burn fall a round after each
            // hit, and before the first only at the Checkup that ends the defender's own turn (Codex on #117: counting
            // a round as already due and then again after the first hit took one hit off).
            let their_turn_first = attacker != probe.current_player;
            Some(Target {
                slot,
                hp: pokemon.get_remaining_hp() as f64
                    - params.pending * pending_damage(probe, defender, slot)
                    - if their_turn_first { poison } else { 0.0 },
                points: knockout_points(&pokemon.card),
                poison: 2.0 * poison,
                burned,
                burn_before: if burned && their_turn_first { BURN_CHECKUP } else { 0.0 },
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
    // With Jungle Totem a Grass Energy can count twice: then the Energy goes on one attachment at a time.
    let doubled = has_serperior_jungle_totem(probe, attacker);
    let active_lost = probe.in_play_pokemon[attacker][0].as_ref().map_or(0.0, |active| {
        if active.is_paralyzed() {
            1.0
        } else if active.is_asleep() {
            if attacker == turn {
                ASLEEP_TURNS_ON_ITS_TURN
            } else {
                ASLEEP_TURNS_ON_THE_RIVALS
            }
        } else {
            0.0
        }
    });
    // No plan takes fewer turns than its setup and a hit (none if every target falls without one), less the spare of
    // each knockout: a plan whose setup already leaves it there is not counted, and the clock gives the same.
    let floor = if targets.iter().any(|target| target.hp > 0.0) { 1.0 } else { 0.0 } - params.margin * targets.len() as f64;
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
        let active = probe.in_play_pokemon[attacker][0].as_ref().expect("in play");
        let attacks = match &active.card {
            Card::Pokemon(pokemon) => pokemon.attacks.clone(),
            _ => Vec::new(),
        };
        let own_type = match &active.card {
            Card::Pokemon(pokemon) => Some(pokemon.energy_type),
            _ => None,
        };
        let (had, attacker_hp) = (active.attached_energy.len(), active.get_remaining_hp() as f64);
        // Evolving into Serperior brings Jungle Totem along, and the copy's Energy count does not know it (deckgym
        // refreshes it when the board changes): each [G] on this Grass Pokémon is put on twice here (Codex on #128).
        let gains_totem = saved.is_some()
            && !doubled
            && own_type == Some(EnergyType::Grass)
            && has_serperior_jungle_totem(probe, attacker);
        let attached = probe.effective_attached_energy(attacker, 0);
        for attack in &attacks {
            let cost = probe.effective_attack_cost(attacker, attack);
            if !reachable(&attached, &cost, &zone) {
                continue;
            }
            if gains_totem {
                let active = probe.in_play_pokemon[attacker][0].as_mut().expect("in play");
                let grass = active.attached_energy.iter().filter(|energy| **energy == EnergyType::Grass).count();
                active.attached_energy.extend(std::iter::repeat_n(EnergyType::Grass, grass));
            }
            // The Energy it still lacks goes on the copy one attachment at a time, as the turns bring it: what counts
            // double (Serperior's Jungle Totem) needs fewer (Codex on #117). The damage is the one it does once ready
            // (Mega Burst does 50 for each Energy it discards, Fighting Pulse more with an extra one).
            let mut attachments = 0;
            if doubled || gains_totem {
                while attachments < cost.len() {
                    let effective = probe.effective_attached_energy(attacker, 0);
                    let Some(&next) = energy_to_attack(&effective, &cost, &zone, own_type).first() else { break };
                    let copies = if gains_totem && next == EnergyType::Grass { 2 } else { 1 };
                    let active = probe.in_play_pokemon[attacker][0].as_mut().expect("in play");
                    active.attached_energy.extend(std::iter::repeat_n(next, copies));
                    attachments += 1;
                }
            } else {
                let lacking = energy_to_attack(&attached, &cost, &zone, own_type);
                attachments = lacking.len();
                probe.in_play_pokemon[attacker][0].as_mut().expect("in play").attached_energy.extend(lacking);
            }
            // The mechanic once per attack: its text is hashed to find it.
            let mechanic = mechanic(attack);
            let (cooldown, recoil, delay) = (cooldown(mechanic), recoil(mechanic), landing_delay(mechanic));
            let overcharges = if scales_with_energy(mechanic) { MAX_OVERCHARGE } else { 0 };
            // A burn already on a target: an attack that burns it again keeps it burning hit by hit; any other leaves it
            // to fade.
            let reburns = inflicts(attack, mechanic).burn > 0.0;
            let burning: Vec<Target> = targets
                .iter()
                .map(|target| Target {
                    hp: target.hp
                        - match (target.burned, reburns) {
                            (false, _) => 0.0,
                            (true, true) => target.burn_before,
                            (true, false) => BURN_LEFT,
                        },
                    ..*target
                })
                .collect();
            for overcharge in 0..=overcharges {
                // One Energy a turn from the zone, for the attacker and for the Active's retreat alike; the Energy, the
                // evolutions and a status that clears go on at the same time (a Paralyzed Active takes this turn's
                // Energy and retreats the next; Codex on #117).
                let setup = (((attachments + overcharge) as f64 / rate).ceil() + promote as f64).max(stages as f64).max(lost);
                if setup + delay + floor >= best {
                    break;
                }
                if overcharge > 0 {
                    // One more Energy than its cost, each step up to `MAX_OVERCHARGE`: a threshold can need two (Energized
                    // Leaves' 5 on both Actives; Codex on #128).
                    let active = probe.in_play_pokemon[attacker][0].as_mut().expect("in play");
                    let extra = extra_energy(mechanic, &active.attached_energy, overcharge, &zone, own_type);
                    active.attached_energy.push(extra);
                }
                let damage: Vec<f64> = burning
                    .iter()
                    .map(|target| damage_against(probe, attacker, attack, mechanic, target.slot, target.poison))
                    .collect();
                let bench: Vec<f64> =
                    targets.iter().map(|target| bench_damage(probe, attacker, attack, mechanic, target.slot)).collect();
                // An attack that discards its Energy waits until it is back: one Energy a turn, more with a charge. With
                // a coin, the expected wait: each outcome rounded to whole turns first. One that cannot attack next turn
                // waits that turn too, both at the same time.
                let ready = probe.in_play_pokemon[attacker][0].as_ref().expect("in play").attached_energy.clone();
                // What it gets back between hits is what it attacks with: fewer cards than its cost when Jungle Totem
                // counts one twice (review of g 1.1).
                let (discard, chance) = self_discard(mechanic, &ready, ready.len().min(cost.len() + overcharge));
                let reuse = (chance * (discard / rate).ceil().max(1.0) + (1.0 - chance)).max(1.0 + cooldown);
                let Some((hits, spare)) = hits_to_win(&burning, &damage, &bench, probe.points[attacker], params.margin)
                else {
                    continue;
                };
                // An attack that also hurts its user: no more hits than it survives (the last may knock it out).
                if recoil > 0.0 && hits > (attacker_hp / recoil).ceil() {
                    continue;
                }
                best = best.min(setup + hits + (hits - 1.0).max(0.0) * (reuse - 1.0) + delay - spare);
            }
            probe.in_play_pokemon[attacker][0].as_mut().expect("in play").attached_energy.truncate(had);
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
/// damage with that Pokémon in the Active Spot, the damage it leaves for later, and the status after the hit: the
/// `poison` the target already takes (it keeps falling every round until the knockout), or the poison or burn the
/// attack inflicts, with its chance. `probe` must have `attacker`'s turn; it is left as it was.
///
/// The engine counts only the damage an attack carries as data. One that also hits a Benched Pokémon of the
/// attacker's choice applies all its damage after that choice, so it gives 0 as soon as there is a Bench: it is asked
/// again with the Benches off the copy (its hit to the Active, with weakness and the rest). One that picks any of the
/// rival's Pokémon, with no fixed damage, gives 0 too: there it is the amount its text says, as f reads it (the target
/// is the attacker's choice, so it can be this one), through the engine so that what the target prevents or reduces
/// still counts, except for one that only picks a damaged Pokémon when this one is not. Abyssal Drop knocks out the
/// spot it picks, whatever its HP.
/// `mechanic` is the attack's, looked up once by the caller.
pub fn damage_against(
    probe: &mut State,
    attacker: usize,
    attack: &Attack,
    mechanic: Option<&Mechanic>,
    slot: usize,
    poison: f64,
) -> f64 {
    let defender = (attacker + 1) % 2;
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
    let target = probe.in_play_pokemon[defender][0].as_ref();
    let remaining = target.map_or(0.0, |target| target.get_remaining_hp() as f64);
    let only_damaged = matches!(mechanic, Some(Mechanic::DirectDamageIfDamaged { .. }));
    // `public_details` copies the Pokémon's effects: only for the one attack that asks.
    let damaged = only_damaged && target.is_some_and(|target| target.public_details().damage > 0);
    let poison_instead = matches!(mechanic, Some(Mechanic::InflictPoisonWithDamage { .. }));
    if matches!(mechanic, Some(Mechanic::SelfDiscardAllEnergyAndDelayedSpotKnockOut)) {
        // Not damage: no reduction or prevention stops it (Codex on #117).
        damage = remaining;
    } else if damage == 0.0 && attack.fixed_damage == 0 && !chooses_bench && !poison_instead && (damaged || !only_damaged) {
        // Garchomp ex's Linear Attack does nothing to Oricorio's Safeguard (Codex on #117). In the Active Spot it takes
        // its Weakness and this turn's boosts, as the engine plays it; on the Bench, never more than the text, and
        // nothing through a Protective Poncho (review of g 1.1).
        let text = attack_damage(attack);
        if text > 0 {
            let plain = plain_damage(probe, attacker, attack, text);
            damage = if slot == 0 {
                plain
            } else if target.is_some_and(has_poncho) {
                0.0
            } else {
                (text as f64).min(plain)
            };
        }
    }
    probe.in_play_pokemon[defender].swap(0, slot);
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
    // The poison the target already has keeps falling a round after each hit of an attack that hurts or that poisons
    // it again: one that does neither does not borrow it as its own hit. Poisoned again, the new poison takes the old
    // one's place with its chance (Toxic on an ordinary poison; Codex on #128). A status-only attack keeps its round
    // once its status has landed (review of g 1.1). The attack's own burn counts each hit; a burn already on the target
    // is in its HP (`Target`).
    let inflicted = inflicts(attack, mechanic);
    let poison = if poison > 0.0 {
        if inflicted.poison > 0.0 {
            inflicted.poison * inflicted.poison_round + (1.0 - inflicted.poison) * poison
        } else if damage > 0.0 {
            poison
        } else {
            0.0
        }
    } else {
        inflicted.poison * inflicted.poison_round
    };
    damage + poison + inflicted.burn * BURN_ROUND
}

/// The engine's damage for a plain attack of `amount` with `attack`'s cost against the defender's Active: Weakness,
/// what the defender prevents or reduces, Tools and the rest.
fn plain_damage(probe: &State, attacker: usize, attack: &Attack, amount: u32) -> f64 {
    let plain = Attack { fixed_damage: amount, effect: None, ..attack.clone() };
    expected_attack_damage(probe, attacker, &plain, (attacker + 1) % 2, 0)
}

/// What a hit of `attack` does to the defender's Pokémon at `slot` while it stays on the Bench, for an attack that also
/// hits every Benched Pokémon (Swirling Disaster, Gigashock; Codex on #117): the amount of its text through the engine,
/// as in `damage_against`, and nothing through a Protective Poncho. 0 for the Active and for every other attack.
fn bench_damage(probe: &mut State, attacker: usize, attack: &Attack, mechanic: Option<&Mechanic>, slot: usize) -> f64 {
    if slot == 0 {
        return 0.0;
    }
    let defender = (attacker + 1) % 2;
    let Some(target) = probe.in_play_pokemon[defender][slot].as_ref() else { return 0.0 };
    let (poncho, has_energy) = (has_poncho(target), !target.attached_energy.is_empty());
    let amount = match mechanic {
        // Wild Spin's +20 from the turn before is the engine's to count, for the Bench as for the Active (Codex on #128).
        // Its Weakness is for the Active Spot only: taken off while asking (Codex on #128).
        Some(Mechanic::DamageAllOpponentPokemonEscalating { .. }) => {
            probe.in_play_pokemon[defender].swap(0, slot);
            let weakness = match &mut probe.in_play_pokemon[defender][0].as_mut().expect("target").card {
                Card::Pokemon(pokemon) => pokemon.weakness.take(),
                _ => None,
            };
            let damage = expected_attack_damage(probe, attacker, attack, defender, 0);
            if let Card::Pokemon(pokemon) = &mut probe.in_play_pokemon[defender][0].as_mut().expect("target").card {
                pokemon.weakness = weakness;
            }
            probe.in_play_pokemon[defender].swap(0, slot);
            damage.round() as u32
        }
        Some(
            Mechanic::DamageAllOpponentPokemon { damage } | Mechanic::SelfDiscardEnergyAndDamageAllOpponentPokemon { damage, .. },
        ) => *damage,
        Some(Mechanic::AlsoBenchDamage { opponent: true, damage, must_have_energy }) => {
            if *must_have_energy && !has_energy {
                0
            } else {
                *damage
            }
        }
        Some(Mechanic::AlsoBenchDamageIfPokemonOnBench { pokemon_name, bench_damage }) => {
            let on_bench = (1..4).any(|at| {
                probe.in_play_pokemon[attacker][at].as_ref().is_some_and(|pokemon| pokemon.get_name() == *pokemon_name)
            });
            if on_bench {
                *bench_damage
            } else {
                0
            }
        }
        Some(
            Mechanic::SelfDiscardRandomEnergyAndBenchDamage { opponent: true, bench_damage, .. }
            | Mechanic::SelfDamageAndAllBenchDamage { bench_damage, .. },
        ) => *bench_damage,
        Some(Mechanic::PalkiaExDimensionalStorm) => 20,
        _ => 0,
    };
    if amount == 0 || poncho {
        return 0.0;
    }
    probe.in_play_pokemon[defender].swap(0, slot);
    let damage = (amount as f64).min(plain_damage(probe, attacker, attack, amount));
    probe.in_play_pokemon[defender].swap(0, slot);
    damage
}

/// Whether a Protective Poncho keeps the damage of attacks off this Pokémon while it is on the Bench.
fn has_poncho(pokemon: &PlayedCard) -> bool {
    pokemon.attached_tools.iter().any(|tool| matches!(tool, Card::Trainer(trainer) if trainer.name == "Protective Poncho"))
}

/// The color of the `nth` Energy more than its cost an attack is tried with: the one its mechanic asks for when the
/// zone makes it (Psykick's [P] on a Medicham with [F][F], a type not yet attached for one that counts types), else the
/// `filler` (Codex on #128).
fn extra_energy(mechanic: Option<&Mechanic>, attached: &[EnergyType], nth: usize, zone: &[EnergyType], own: Option<EnergyType>) -> EnergyType {
    let made = |energy: EnergyType| zone.contains(&energy).then_some(energy);
    let asked = match mechanic {
        Some(
            Mechanic::ExtraDamageIfSelfHasTypeEnergy { energy_type, .. }
            | Mechanic::ExtraDamagePerSpecificEnergy { energy_type, .. }
            | Mechanic::ExtraDamagePerSpecificEnergyAllYours { energy_type, .. }
            | Mechanic::CoinFlipPerSpecificEnergyType { energy_type, .. },
        ) => made(*energy_type),
        Some(Mechanic::ExtraDamageIfExtraEnergy { required_extra_energy, .. }) => {
            required_extra_energy.get(nth.saturating_sub(1)).copied().and_then(made)
        }
        Some(Mechanic::SelfDiscardAllTypesEnergyDamagePerDiscarded { energy_types, .. }) => {
            let own = filler(zone, own);
            if energy_types.contains(&own) {
                Some(own)
            } else {
                energy_types.iter().copied().find_map(made)
            }
        }
        Some(Mechanic::ExtraDamageIfDifferentEnergyTypesAttached { .. } | Mechanic::ExtraDamagePerEnergyType { .. }) => {
            zone.iter().copied().find(|energy| !attached.contains(energy))
        }
        _ => None,
    };
    asked.unwrap_or_else(|| filler(zone, own))
}

/// The color of the Energy the clock attaches for a Colorless cost: the Pokémon's own type if the zone makes it, else
/// the zone's first (an empty zone is taken as unknown: the Pokémon's type).
fn filler(zone: &[EnergyType], own: Option<EnergyType>) -> EnergyType {
    match own {
        Some(own) if zone.is_empty() || zone.contains(&own) => own,
        _ => zone.first().copied().unwrap_or(EnergyType::Colorless),
    }
}

/// The Energy `attached` still lacks to pay `cost`: each typed one, and for the Colorless ones the `filler`.
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
    extra.extend(std::iter::repeat_n(filler(zone, own), colorless.saturating_sub(left.len())));
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
/// most hits per point; with one point to go, the most hits). `None` when the one in the Active cannot be hurt. The
/// whole hits, and apart `margin` times the hit each knockout has to spare: the caller takes it off the turns once, so
/// a wait between hits does not multiply it (review of g 1.1). An attack that also hits the Bench
/// (`bench`, what a hit does to each Benched one) wears them down at the same time, so they go one hit at a time: three
/// Pokémon with 50 HP fall together to five hits of Swirling Disaster, not to fifteen (Codex on #117).
fn hits_to_win(targets: &[Target], damage: &[f64], bench: &[f64], points: u8, margin: f64) -> Option<(f64, f64)> {
    let mut hp: Vec<f64> = targets.iter().map(|target| target.hp).collect();
    let mut standing: Vec<bool> = vec![true; targets.len()];
    let mut active = targets.iter().position(|target| target.slot == 0);
    let mut points = points;
    let (mut total, mut spare) = (0.0, 0.0);
    // The whole hits to knock out `at` from `hp`, and the hit it has to spare.
    let whole = |hp: f64, at: usize| -> Option<(f64, f64)> {
        if hp <= 0.0 {
            Some((0.0, 0.0))
        } else if damage[at] <= 0.0 {
            None
        } else {
            let exact = hp / damage[at];
            Some((exact.ceil(), exact.ceil() - exact))
        }
    };
    let hits = |hp: f64, at: usize| whole(hp, at).map(|(hits, left)| hits - margin * left);
    // Enough for any clock under `NO_THREAT`.
    for _ in 0..64 {
        for at in 0..targets.len() {
            if standing[at] && hp[at] <= 0.0 {
                standing[at] = false;
                points += targets[at].points;
                if active == Some(at) {
                    active = None;
                }
            }
        }
        if points >= 3 || !standing.contains(&true) {
            return Some((total, spare));
        }
        let at = match active {
            Some(at) => at,
            None => {
                let cost = |at: usize| match hits(hp[at], at) {
                    None => f64::INFINITY,
                    Some(h) if points == 2 => h,
                    Some(h) => h / f64::from(targets[at].points.max(1)),
                };
                let mut pick = None;
                for at in (0..targets.len()).filter(|&at| standing[at]) {
                    if pick.is_none_or(|best| cost(at) >= cost(best)) {
                        pick = Some(at);
                    }
                }
                let at = pick.expect("one standing");
                active = Some(at);
                at
            }
        };
        let spread = (0..targets.len()).any(|other| other != at && standing[other] && bench[other] > 0.0);
        if !spread {
            // Only the Active takes damage: all its hits at once.
            let (hits, left) = whole(hp[at], at)?;
            total += hits;
            spare += margin * left;
            hp[at] = 0.0;
            continue;
        }
        // An Active it cannot hurt only holds back its own knockout: the Bench still takes its share, and its points can
        // still win (an ex against Oricorio's Safeguard; Codex on #128).
        hp[at] -= damage[at].max(0.0);
        for other in (0..targets.len()).filter(|&other| other != at && standing[other]) {
            hp[other] -= bench[other];
        }
        total += 1.0;
        if hp[at] <= 0.0 && damage[at] > 0.0 {
            spare += margin * (-hp[at] / damage[at]).min(1.0);
        }
    }
    None
}

/// The damage already on its way to `player`'s Pokémon at `slot`: Cursed Prose's (a `DelayedDamage` on it), a
/// delayed hit on its spot and a knockout scheduled on its spot (Abyssal Drop: all its HP). Poison and burn are not
/// here: the clock counts them hit by hit (`Target`).
fn pending_damage(state: &State, player: usize, slot: usize) -> f64 {
    let Some(pokemon) = state.in_play_pokemon[player][slot].as_ref() else { return 0.0 };
    let details = pokemon.public_details();
    let mut pending = 0.0;
    for (effect, _) in &details.effects {
        if let CardEffect::DelayedDamage { amount } = effect {
            pending += *amount as f64;
        }
    }
    // deckgym keeps a delayed hit or knockout on a spot (Meowscarada ex's Flower Trick, Armaldo's Abyssal Drop) in this
    // turn and the next, lands it at the end of its target's turn and never removes the old entries: it is due once,
    // from this turn's entry when the target is the player whose turn it is, else from the next turn's (review of #117).
    let turn = state.turn_count;
    for (at, targets_this_turn) in [(turn, true), (turn.saturating_add(1), false)] {
        for effect in state.public_turn_effects().get(&at).into_iter().flatten() {
            let (target_player, target_in_play_idx, amount) = match effect {
                TurnEffect::DelayedSpotDamage { target_player, target_in_play_idx, amount, .. } => {
                    (*target_player, *target_in_play_idx, *amount as f64)
                }
                TurnEffect::DelayedSpotKnockOut { target_player, target_in_play_idx, .. } => {
                    (*target_player, *target_in_play_idx, pokemon.get_remaining_hp() as f64)
                }
                _ => continue,
            };
            let due = (target_player == state.current_player) == targets_this_turn;
            if target_player == player && target_in_play_idx == slot && due {
                pending += amount;
            }
        }
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

/// Energy an attack discards from the attacker that it gets back before each next hit, and the chance it discards (a
/// coin: ½). Between hits the attacker gets back only what it attacks with, `held`: an overcharged Raichu discards all
/// five on its first Thunderbolt and needs its three back for the next (Codex on #117), so «all» is `held`, no more.
fn self_discard(mechanic: Option<&Mechanic>, attached: &[EnergyType], held: usize) -> (f64, f64) {
    let all = held as f64;
    let of = |types: &[EnergyType]| (attached.iter().filter(|energy| types.contains(energy)).count() as f64).min(all);
    let discard = match mechanic {
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
        // The damage comes from what it discards: to hit as hard again it needs all of it back, not just its cost
        // (Mega Rayquaza ex with five Energy does 250, and needs five more for the next 250; Codex on #128).
        Some(Mechanic::SelfDiscardAllTypesEnergyDamagePerDiscarded { energy_types, .. }) => {
            attached.iter().filter(|energy| energy_types.contains(energy)).count() as f64
        }
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

/// The chance that an attack keeps its user from attacking (or from using it again) during its next turn: Prismatic
/// Laser, Big Beat, on tails for some (Codex on #117). Its next hit waits a turn more.
fn cooldown(mechanic: Option<&Mechanic>) -> f64 {
    let locks = |effect: &CardEffect| matches!(effect, CardEffect::CannotAttack | CardEffect::CannotUseAttack(_));
    match mechanic {
        Some(Mechanic::DamageAndCardEffect { opponent: false, effect, coin_flip, .. }) if locks(effect) => {
            if *coin_flip {
                0.5
            } else {
                1.0
            }
        }
        Some(Mechanic::CoinFlipTailsSelfCardEffect { effect, .. }) if locks(effect) => 0.5,
        Some(
            Mechanic::DirectDamageAndSelfCardEffect { effect, .. }
            | Mechanic::SelfDiscardEnergyAndCardEffect { effect, .. }
            | Mechanic::SelfDiscardRandomEnergyAndCardEffect { effect, .. },
        ) if locks(effect) => 1.0,
        _ => 0.0,
    }
}

/// The damage an attack does to its own user per hit, on average (a coin: ½; Codex on #117: Beat Punk, Enormous
/// Explosion). The one only on a knockout (`RecoilIfKo`) is left out.
fn recoil(mechanic: Option<&Mechanic>) -> f64 {
    match mechanic {
        Some(Mechanic::SelfDamage { amount }) => *amount as f64,
        Some(
            Mechanic::CoinFlipSelfDamage { self_damage } | Mechanic::CoinFlipExtraDamageOrSelfDamage { self_damage, .. },
        ) => *self_damage as f64 / 2.0,
        Some(Mechanic::SelfDamageAndAllBenchDamage { self_damage, .. }) => *self_damage as f64,
        _ => 0.0,
    }
}

/// Turns between an attack and its knockout: Abyssal Drop's lands at the end of the rival's next turn.
fn landing_delay(mechanic: Option<&Mechanic>) -> f64 {
    match mechanic {
        Some(Mechanic::SelfDiscardAllEnergyAndDelayedSpotKnockOut) => 1.0,
        _ => 0.0,
    }
}

/// Whether an attack does more with more Energy on its user: the ones the clock tries with up to `MAX_OVERCHARGE` more.
fn scales_with_energy(mechanic: Option<&Mechanic>) -> bool {
    matches!(
        mechanic,
        Some(
            Mechanic::CoinFlipPerSpecificEnergyType { .. }
                | Mechanic::DamagePerEnergyAll { .. }
                | Mechanic::DiscardSelfEnergyPerHeadsExtraDamage { .. }
                | Mechanic::ExtraDamageIfCombinedActiveEnergyAtLeast { .. }
                | Mechanic::ExtraDamageIfDifferentEnergyTypesAttached { .. }
                | Mechanic::ExtraDamageIfExtraEnergy { .. }
                | Mechanic::ExtraDamageIfMoreEnergyThanOpponent { .. }
                | Mechanic::ExtraDamageIfSelfHasTypeEnergy { .. }
                | Mechanic::ExtraDamageIfTypeEnergyInPlay { .. }
                | Mechanic::ExtraDamagePerEnergy { .. }
                | Mechanic::ExtraDamagePerEnergyType { .. }
                | Mechanic::ExtraDamagePerSpecificEnergy { .. }
                | Mechanic::ExtraDamagePerSpecificEnergyAllYours { .. }
                | Mechanic::RandomDamageToOpponentPokemonPerSelfEnergy { .. }
                | Mechanic::SelfDiscardAllTypeEnergyAndDamageAnyOpponentPokemon { .. }
                | Mechanic::SelfDiscardAllTypesEnergyDamagePerDiscarded { .. }
        )
    )
}

/// The poison and burn an attack leaves on the defender's Active: the chance of each, and the poison's round.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Inflicted {
    poison: f64,
    poison_round: f64,
    burn: f64,
}

/// What an attack poisons or burns, with its chance from its mechanic (a coin ½; Cross Poison's «at least 2 heads of
/// 4» 11/16; Codex on #117), and from its text for one the engine has no mechanic for.
fn inflicts(attack: &Attack, mechanic: Option<&Mechanic>) -> Inflicted {
    use StatusCondition::{Burned, Poisoned};
    let on = |conditions: &[StatusCondition], chance: f64| Inflicted {
        poison: if conditions.contains(&Poisoned) { chance } else { 0.0 },
        poison_round: POISON_ROUND,
        burn: if conditions.contains(&Burned) { chance } else { 0.0 },
    };
    let none = on(&[], 0.0);
    match mechanic {
        Some(Mechanic::InflictPoisonWithDamage { poison_damage }) => {
            Inflicted { poison: 1.0, poison_round: 2.0 * *poison_damage as f64, burn: 0.0 }
        }
        Some(Mechanic::InflictStatusConditions { conditions, target_opponent }) => {
            if *target_opponent {
                on(conditions, 1.0)
            } else {
                none
            }
        }
        Some(
            Mechanic::InflictStatusConditionsOnBothActive { conditions }
            | Mechanic::SelfDiscardEnergyAndInflictStatus { conditions, .. }
            | Mechanic::SelfDiscardAllEnergyAndInflictStatus { conditions }
            | Mechanic::InflictStatusConditionsAndShuffleSelfIntoDeck { conditions }
            | Mechanic::InflictStatusConditionsAndCardEffect { conditions, .. },
        ) => on(conditions, 1.0),
        // Only the first attack after coming into play: not one hit after another (Codex on #128).
        Some(Mechanic::FirstAttackBonusDamageAndStatus { .. }) => none,
        Some(Mechanic::ExtraDamageForEachHeadsWithStatus { status, .. }) => on(std::slice::from_ref(status), 1.0),
        Some(
            Mechanic::ChanceStatusAttack { condition: status }
            | Mechanic::CoinFlipNoDamageOrStatusAttack { status }
            | Mechanic::CoinFlipStatusSelfOrOpponent { status },
        ) => on(std::slice::from_ref(status), 0.5),
        Some(Mechanic::ChanceMultipleStatusAttack { conditions }) => on(conditions, 0.5),
        Some(Mechanic::CoinFlipStatusOutcome { heads_status, tails_status }) => {
            let (heads, tails) = (on(std::slice::from_ref(heads_status), 0.5), on(std::slice::from_ref(tails_status), 0.5));
            Inflicted { poison: heads.poison + tails.poison, poison_round: POISON_ROUND, burn: heads.burn + tails.burn }
        }
        Some(Mechanic::ExtraDamageForEachHeadsWithStatusAtLeast { num_coins, status, min_heads, .. }) => {
            on(std::slice::from_ref(status), at_least_heads(*num_coins, *min_heads))
        }
        Some(Mechanic::RandomStatusFromAmong { conditions }) if !conditions.is_empty() => {
            on(conditions, 1.0 / conditions.len() as f64)
        }
        // Burn does more a round than poison: the player picks it.
        Some(Mechanic::ChooseStatusToInflict { options }) => {
            if options.contains(&Burned) {
                on(&[Burned], 1.0)
            } else {
                on(options, 1.0)
            }
        }
        Some(_) => none,
        None => {
            let Some(effect) = attack.effect.as_deref() else { return none };
            let chance = if effect.starts_with("Flip a coin") { 0.5 } else { 1.0 };
            let mut conditions = Vec::new();
            if effect.contains("is now Poisoned") {
                conditions.push(Poisoned);
            }
            if effect.contains("is now Burned") {
                conditions.push(Burned);
            }
            on(&conditions, chance)
        }
    }
}

/// The chance of at least `min` heads in `coins` flips.
fn at_least_heads(coins: usize, min: usize) -> f64 {
    let mut ways = 0u64;
    let mut choose = 1u64;
    for heads in 0..=coins {
        if heads > 0 {
            choose = choose * (coins - heads + 1) as u64 / heads as u64;
        }
        if heads >= min {
            ways += choose;
        }
    }
    ways as f64 / (1u64 << coins) as f64
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

    /// `damage_against` with the attack's own mechanic.
    fn damage(probe: &mut State, attacker: usize, attack: &Attack, slot: usize, poison: f64) -> f64 {
        damage_against(probe, attacker, attack, mechanic(attack), slot, poison)
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

    /// The clock in whole hits (no `margin`), as most tests count it.
    fn turns(state: &State, attacker: usize, see_evolutions: bool) -> f64 {
        turns_with(state, attacker, see_evolutions, &GParams { margin: 0.0, ..GParams::default() })
    }

    fn turns_with(state: &State, attacker: usize, see_evolutions: bool, params: &GParams) -> f64 {
        let mut probe = state.clone();
        let turns = turns_to_win(&mut probe, attacker, see_evolutions, params);
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
            let damage = damage(&mut probe, 0, &first_attack(&dedenne), 0, 0.0);
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
    fn g2_plays_a_third_tool_before_dede_circuit() {
        use deckgym::players::{ExpectiMiniMaxPlayer, Player};
        // Dedenne ex ready in the Active with a Tool, Indeedee ex with another on the Bench, Oricorio with none and
        // Clear Veil in the hand: Dede-Circuit does 80, and 120 with the Veil on Oricorio. A Mega Absol ex with 150 HP
        // left takes two hits either way (Dedenne, 18/10/2026).
        let mine = vec![
            card("B3b 024").with_energy(vec![Lightning, Lightning]).with_tool(tool("A2 147")),
            card("B1 121").with_tool(tool("B3b 064")),
            card("A3 165"),
        ];
        let mut state = board(DEDENNE, HYDREIGON, mine, vec![card("B1 151").with_remaining_hp(150)]);
        state.hands[0] = vec![tool("B4 149")];
        state.turn_count = 3;
        // The clock: the Veil saves no whole hit, and still brings Dedenne a little closer (`margin`).
        let mut veiled = state.clone();
        veiled.hands[0].clear();
        veiled.in_play_pokemon[0][2].as_mut().expect("Oricorio").attached_tools = vec![tool("B4 149")];
        assert_eq!(turns(&veiled, 0, true), turns(&state, 0, true));
        let (with, without) = (turns_with(&veiled, 0, true, &GParams::default()), turns_with(&state, 0, true, &GParams::default()));
        assert!(with < without && without - with < 0.25, "{with} vs {without}");
        let tools_when_attacking = |params: GParams| -> usize {
            let bot = |deck: &str| -> Box<dyn Player> {
                Box::new(ExpectiMiniMaxPlayer {
                    deck: Deck::from_string(deck).expect("deck"),
                    max_depth: 2,
                    write_debug_trees: false,
                    value_function: Box::new(move |state: &State, myself: usize| g_value_function(state, myself, &params)),
                })
            };
            let mut game = Game::from_state(state.clone(), vec![bot(DEDENNE), bot(HYDREIGON)], 7);
            loop {
                let before = game.get_state_clone();
                let action = game.play_tick();
                assert_eq!(action.actor, 0, "Dedenne's side ended its turn without attacking");
                if let SimpleAction::Attack(_) = action.action {
                    return before.enumerate_in_play_pokemon(0).map(|(_, pokemon)| pokemon.attached_tools.len()).sum();
                }
            }
        };
        assert_eq!(tools_when_attacking(GParams::default()), 3);
        // g 1.0 attacked with two: playing a Tool takes two decisions (the card, then the Pokémon), so at depth 2 the
        // attack fell past the leaf, while attacking first showed its damage at once.
        assert_eq!(tools_when_attacking(GParams { margin: 0.0, attack_now: false, ..GParams::default() }), 2);
    }

    /// The blind spot of Dedenne (18/10/2026) as a fixed case: in real games of deck 16, how often g2 attacks with
    /// Dede-Circuit while it still holds a Tool it could attach. g 1.0 did in 83 of 110 attacks (e2 in 119 of 123).
    #[test]
    fn dedenne_attaches_its_tools_before_attacking() {
        use deckgym::players::{ExpectiMiniMaxPlayer, Player};
        let (mut attacks, mut held) = (0, 0);
        for rival in [LUCARIO, SUICUNE] {
            for seed in 0..6u64 {
                let bot = |deck: &str| -> Box<dyn Player> {
                    let params = GParams::default();
                    Box::new(ExpectiMiniMaxPlayer {
                        deck: Deck::from_string(deck).expect("deck"),
                        max_depth: 2,
                        write_debug_trees: false,
                        value_function: Box::new(move |state: &State, myself: usize| g_value_function(state, myself, &params)),
                    })
                };
                let mut game = Game::new(vec![bot(DEDENNE), bot(rival)], seed);
                while !game.is_game_over() && game.get_state_clone().turn_count < 31 {
                    let state = game.get_state_clone();
                    let action = game.play_tick();
                    let attacking = action.actor == 0 && matches!(action.action, SimpleAction::Attack(_));
                    let Some(active) = state.in_play_pokemon[0][0].as_ref().filter(|_| attacking) else { continue };
                    if active.get_name() != "Dedenne ex" {
                        continue;
                    }
                    let free = state.enumerate_in_play_pokemon(0).filter(|(_, pokemon)| pokemon.attached_tools.is_empty()).count();
                    let tools = state.hands[0]
                        .iter()
                        .filter(|card| matches!(card, Card::Trainer(trainer) if trainer.trainer_card_type == TrainerType::Tool))
                        .count();
                    attacks += 1;
                    held += usize::from(tools.min(free) > 0);
                }
            }
        }
        assert!(attacks >= 15, "only {attacks} attacks");
        assert!(held * 5 <= attacks, "{held} of {attacks} attacks with a Tool it could attach");
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
            assert_eq!(damage(&mut probe, 1, &attack, 0, 0.0), expected);
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
        // Latias' Crossing Flights (20, no Latios on the Bench) against Indeedee ex (130 HP): 7 hits.
        let state = board(MISMAGIUS, DEDENNE, vec![card("A4a 036").with_energy(vec![Psychic])], vec![card("B1 121")]);
        assert_eq!(pending_damage(&state, 1, 0), 0.0);
        assert_eq!(turns(&state, 0, false), 7.0);
        // Poisoned, 20 a round after each hit: 4 hits, not 3 (Codex on #117: three rounds do only 120). The clock
        // counts it hit by hit, not as damage on its way.
        let mut poisoned = state.clone();
        poisoned.apply_status_condition(1, 0, StatusCondition::Poisoned);
        assert_eq!(pending_damage(&poisoned, 1, 0), 0.0);
        assert_eq!(turns(&poisoned, 0, false), 4.0);
        // On Indeedee's turn a Checkup comes before the first hit: 120 left, 3 hits.
        poisoned.current_player = 1;
        assert_eq!(turns(&poisoned, 0, false), 3.0);
        // Burned, and Crossing Flights does not burn it again: the burn fades, 40 in all (Codex on #128: a round after
        // every hit overstated it). 90 left, 5 hits, on either turn.
        let mut burned = state.clone();
        burned.apply_status_condition(1, 0, StatusCondition::Burned);
        assert_eq!(pending_damage(&burned, 1, 0), 0.0);
        assert_eq!(turns(&burned, 0, false), 5.0);
        burned.current_player = 1;
        assert_eq!(turns(&burned, 0, false), 5.0);
    }

    #[test]
    fn luster_purge_hits_every_three_turns() {
        let latios = card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic]);
        let attack = first_attack(&latios);
        assert_eq!(self_discard(mechanic(&attack), &latios.attached_energy, attack.energy_required.len()), (3.0, 1.0));
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
        // on (the engine says 0 on the board as it is). Against a Dedenne ex (120 HP) that is 2 hits, then it waits for
        // its 2 Energy again: 2 turns to get ready, 1 + 2 to hit twice. With a third Energy first it does 150 and knocks
        // it out at once: 3 turns and 1 hit (Codex on #117).
        let rayquaza = "Energy: Fire, Lightning\n2 Dratini A1 183\n2 Dragonair B4 117\n2 X B3a 54\n1 Mega Rayquaza ex B4 120\n2 Professor's Research P-A 7\n2 Copycat B1 225\n1 Pokémon Center Lady A2b 70\n1 X B3a 72\n1 Cyrus A2 150\n2 Poké Ball P-A 5\n1 X B3a 69\n2 X B4 155\n1 X B2b 69\n";
        let state = board(rayquaza, DEDENNE, vec![card("B4 120")], vec![card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 3.0 + 1.0);
    }

    #[test]
    fn an_asleep_or_paralyzed_active_loses_its_turn() {
        let latios = card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic]);
        let awake = board(MISMAGIUS, DEDENNE, vec![latios], vec![card("B3b 024")]);
        let mut asleep = awake.clone();
        asleep.apply_status_condition(0, 0, StatusCondition::Asleep);
        let mut paralyzed = awake.clone();
        paralyzed.apply_status_condition(0, 0, StatusCondition::Paralyzed);
        assert_eq!(turns(&asleep, 0, false), turns(&awake, 0, false) + ASLEEP_TURNS_ON_ITS_TURN);
        assert_eq!(turns(&paralyzed, 0, false), turns(&awake, 0, false) + 1.0);
        // On the rival's turn a Checkup comes first: Asleep loses 2/3 of a turn, Paralyzed still its next one.
        let on_theirs = |state: &State| {
            let mut theirs = state.clone();
            theirs.current_player = 1;
            theirs
        };
        assert_eq!(turns(&on_theirs(&asleep), 0, false), turns(&on_theirs(&awake), 0, false) + ASLEEP_TURNS_ON_THE_RIVALS);
        assert_eq!(turns(&on_theirs(&paralyzed), 0, false), turns(&on_theirs(&awake), 0, false) + 1.0);
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
        assert_eq!(damage(&mut alone.clone(), 0, &attack, 0, 0.0), 30.0);
        let mut probe = benched.clone();
        assert_eq!(damage(&mut probe, 0, &attack, 0, 0.0), 30.0);
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
        assert_eq!(damage(&mut probe, 0, &dede_circuit, 0, 0.0), 50.0);
    }

    #[test]
    fn toxic_and_pierce_the_pain_are_read_by_their_mechanic() {
        let toxicroak = card("A2a 052").with_energy(vec![EnergyType::Darkness]);
        let decidueye = card("A3 012").with_energy(vec![EnergyType::Grass, EnergyType::Grass]);
        let target = |damage: u32| board(DEDENNE, DEDENNE, vec![toxicroak.clone(), decidueye.clone()], vec![card("B3b 024").with_damage(damage)]);
        // Toxic does no damage: its poison is 20 at each Checkup, 40 a round (f read «20 damage» as a hit).
        assert_eq!(crate::fair_bot::attack_damage(&first_attack(&toxicroak)), 20);
        assert_eq!(damage(&mut target(0), 0, &first_attack(&toxicroak), 0, 0.0), 40.0);
        // On a target already Poisoned it poisons it again: its 40 a round go on (review of g 1.1; it gave 0, and the
        // clock jumped to «no threat» once the poison had landed), and on an ordinary poison its 40 replace the 20
        // (Codex on #128).
        assert_eq!(damage(&mut target(0), 0, &first_attack(&toxicroak), 0, 40.0), 40.0);
        assert_eq!(damage(&mut target(0), 0, &first_attack(&toxicroak), 0, 20.0), 40.0);
        // Pierce the Pain: 100 to a Pokémon with damage on it; none to one without.
        let mut probe = target(10);
        probe.in_play_pokemon[0].swap(0, 1);
        assert_eq!(damage(&mut probe, 0, &first_attack(&decidueye), 0, 0.0), 100.0);
        let mut probe = target(0);
        probe.in_play_pokemon[0].swap(0, 1);
        assert_eq!(damage(&mut probe, 0, &first_attack(&decidueye), 0, 0.0), 0.0);
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
        let seen = |board: &State| damage(&mut board.clone(), 0, &cyberjack, 0, 0.0);
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
        assert_eq!(damage(&mut state.clone(), 0, &first_attack(&latias), 0, 20.0), 40.0);
        // An attack that does nothing does not borrow the poison as its own hit.
        let ivysaur = card("B1a 002").with_energy(vec![EnergyType::Grass]);
        assert_eq!(damage(&mut state.clone(), 0, &first_attack(&ivysaur), 0, 20.0), 0.0);
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
        assert_eq!(turns(&asleep, 0, false), turns(&awake, 0, false) + ASLEEP_TURNS_ON_ITS_TURN);
        // Codex on #117: Misdreavus Paralyzed and with no Energy for its retreat takes it this turn and retreats the
        // next, as it would awake: the lock and the Energy overlap.
        let mine = vec![card("A2 066"), card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic])];
        let stuck = board(MISMAGIUS, DEDENNE, mine, vec![card("B3b 024")]);
        let mut stuck_paralyzed = stuck.clone();
        stuck_paralyzed.apply_status_condition(0, 0, StatusCondition::Paralyzed);
        assert_eq!(turns(&stuck_paralyzed, 0, false), turns(&stuck, 0, false));
        assert_eq!(turns(&stuck, 0, false), turns(&awake, 0, false) + 1.0);
    }

    #[test]
    fn a_coin_flip_discard_waits_on_average_after_rounding() {
        use EnergyType::Fire;
        // Self-review of #117 (Codex): Entei's Strong Flare (110, «Flip a coin. If tails, discard 2 random Energy»):
        // the next hit is 1 turn away on heads and 2 on tails, 1.5 on average (halving before rounding gave 1, no
        // wait at all). Against two Dedenne ex (120 HP, 2 points each): 2 hits each, 4 hits, 3 waits of 1.5.
        let entei = card("A4 033").with_energy(vec![Fire; 4]);
        let (discard, chance) = self_discard(mechanic(&first_attack(&entei)), &entei.attached_energy, first_attack(&entei).energy_required.len());
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

    // Codex's findings on #117 (15 and 18/10/2026), one test each.

    #[test]
    fn abyssal_drop_knocks_out_the_spot_it_picks() {
        use deckgym::actions::{Action, SimpleAction};
        let armaldo = card("B4 082").with_energy(vec![EnergyType::Fighting; 3]);
        let theirs = vec![card("B3b 024"), card("A3 165")];
        let state = board(DEDENNE, DEDENNE, vec![armaldo], theirs);
        // Dedenne ex (2 points), then Oricorio: a drop each, whatever their HP, and its 3 Energy back between them; the
        // last knockout lands at the end of the rival's next turn. Before, no damage meant no threat at all.
        assert_eq!(turns(&state, 0, false), 2.0 + (3.0 - 1.0) + 1.0);
        // A drop already scheduled on a spot is lethal for it.
        let mut game = Game::from_state(state, Vec::new(), 9);
        let schedule = SimpleAction::ScheduleDelayedSpotKnockOut { target_player: 1, target_in_play_idx: 0 };
        game.apply_action(&Action { actor: 0, action: schedule, is_stack: false });
        let scheduled = game.get_state_clone();
        assert_eq!(pending_damage(&scheduled, 1, 0), 120.0);
        assert_eq!(pending_damage(&scheduled, 1, 1), 0.0);
    }

    #[test]
    fn jungle_totem_makes_one_grass_energy_count_twice() {
        // Bulbasaur's Vine Whip ([G][C], 40) against Dedenne ex (120 HP): 3 hits after 2 Energy, or after 1 with
        // Serperior's Jungle Totem in play (Codex on #117).
        let alone = board(VENUSAUR, DEDENNE, vec![card("A1 001")], vec![card("B3b 024")]);
        let with_totem = board(VENUSAUR, DEDENNE, vec![card("A1 001"), card("A1a 006")], vec![card("B3b 024")]);
        assert_eq!(turns(&alone, 0, false), 2.0 + 3.0);
        assert_eq!(turns(&with_totem, 0, false), 1.0 + 3.0);
    }

    #[test]
    fn linear_attack_does_nothing_through_safeguard() {
        // Garchomp ex's Linear Attack (50 to 1 of the rival's Pokémon, no fixed damage): its text, through the engine.
        let garchomp = card("A2a 047").with_energy(vec![EnergyType::Fighting]);
        let mut walled = board(DEDENNE, DEDENNE, vec![garchomp.clone()], vec![card("A3 165")]);
        assert_eq!(damage(&mut walled, 0, &first_attack(&garchomp), 0, 0.0), 0.0);
        // In the Active Spot, Dedenne ex's Weakness to [F] makes it 70, as the engine plays it (review of g 1.1).
        let mut open = board(DEDENNE, DEDENNE, vec![garchomp.clone()], vec![card("B3b 024"), card("B3b 024")]);
        assert_eq!(damage(&mut open, 0, &first_attack(&garchomp), 0, 0.0), 70.0);
        // On the Bench no Weakness, never more than the text, and nothing through a Protective Poncho.
        assert_eq!(damage(&mut open, 0, &first_attack(&garchomp), 1, 0.0), 50.0);
        open.in_play_pokemon[1][1].as_mut().expect("Dedenne ex").attached_tools = vec![tool("B2 147")];
        assert_eq!(damage(&mut open, 0, &first_attack(&garchomp), 1, 0.0), 0.0);
    }

    #[test]
    fn a_poisoner_plays_its_giant_cape_before_attacking() {
        use deckgym::players::{ExpectiMiniMaxPlayer, Player};
        // Review of g 1.1: Roserade's Poison Ring with two [G], Giant Cape in the hand, against a Mega Absol ex with
        // 170 HP. «Attack now» valued the attack before the end of the turn, without the poison of its Checkup, and g2
        // attacked without the Cape; scored after the turn ends, as the search scores its own attacks, it plays the Cape.
        let grass = "Energy: Grass\n2 Roselia B2 4\n2 Roserade B2 5\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n2 Giant Cape A2 147\n2 Rocky Helmet A2 148\n2 Lucky Ice Pop B2 145\n2 Cyrus A2 150\n2 Sabrina A1 225\n";
        let roserade = card("B2 005").with_energy(vec![EnergyType::Grass, EnergyType::Grass]);
        let mut state = board(grass, HYDREIGON, vec![roserade], vec![card("B1 151").with_remaining_hp(170)]);
        state.hands[0] = vec![tool("A2 147")];
        state.turn_count = 3;
        let bot = |deck: &str| -> Box<dyn Player> {
            let params = GParams::default();
            Box::new(ExpectiMiniMaxPlayer {
                deck: Deck::from_string(deck).expect("deck"),
                max_depth: 2,
                write_debug_trees: false,
                value_function: Box::new(move |state: &State, myself: usize| g_value_function(state, myself, &params)),
            })
        };
        let mut game = Game::from_state(state, vec![bot(grass), bot(HYDREIGON)], 7);
        let first = game.play_tick();
        assert!(matches!(&first.action, SimpleAction::Play { trainer_card } if trainer_card.name == "Giant Cape"), "{:?}", first.action);
    }

    #[test]
    fn hide_counts_the_cards_the_rival_has_shown() {
        // Baxcalibur over Frigibax (Rare Candy) is two Pokémon of the list, not three; its Giant Cape a Trainer; a Fossil
        // in play a Trainer, as is each card in the discard pile (review of g 1.1).
        let mut baxcalibur = card("B2a 036").with_tool(tool("A2 147"));
        baxcalibur.cards_behind = vec![tool("B2a 034")];
        let state = board(DEDENNE, SUICUNE, vec![card("B3b 024")], vec![baxcalibur, card("A2 144")]);
        assert_eq!(shown(&state, 1), (2, 2));
        let mut discarded = state.clone();
        discarded.discard_piles[1] = vec![tool("P-A 007"), tool("A4a 020")];
        assert_eq!(shown(&discarded, 1), (3, 3));
    }

    #[test]
    fn a_discard_all_attack_gets_back_only_what_it_attacks_with() {
        // Infernape ex's Flare Blitz ([R][R], discard all [R]) with five [R]: two between hits, not five.
        let flare_blitz = first_attack(&card("A2 029"));
        assert_eq!(self_discard(mechanic(&flare_blitz), &[EnergyType::Fire; 5], 2), (2.0, 1.0));
        // With fewer cards than its cost (Jungle Totem counts one twice), what it has.
        assert_eq!(self_discard(mechanic(&flare_blitz), &[EnergyType::Fire], 1), (1.0, 1.0));
    }

    #[test]
    fn the_spare_hit_is_taken_off_once_whatever_the_wait() {
        // Latios' Luster Purge (120, discards its 3 Energy) against a Mega Venusaur ex with 130 HP left: 2 hits with a
        // wait of 3 between them. The spare (10 HP of the second hit) is worth 0.1 of a hit at most, not multiplied by
        // the wait (review of g 1.1: it came to 0.275).
        let latios = card("A4a 037").with_energy(vec![Psychic, Psychic, Psychic]);
        let state = board(MISMAGIUS, VENUSAUR, vec![latios], vec![card("B1a 004").with_remaining_hp(130)]);
        let (whole, with_margin) = (turns(&state, 0, false), turns_with(&state, 0, false, &GParams::default()));
        assert!(whole - with_margin > 0.0 && whole - with_margin <= 0.1, "{whole} vs {with_margin}");
    }

    /// What «attack now» takes for granted: after an attack that leaves no choice and does not end the game, the only
    /// action is the attacker's end of turn. Checked on the attacks of real games (3.097 outcomes on 18/10/2026).
    #[test]
    fn after_an_attack_only_the_end_of_the_turn_is_left() {
        use deckgym::players::{create_players as players, PlayerCode};
        let decks = [DEDENNE, MISMAGIUS, VENUSAUR, LUCARIO, SUICUNE, HYDREIGON, crate::coach::tests::ALTARIA];
        let (mut checked, mut other) = (0, Vec::new());
        for a in 0..decks.len() {
            for b in 0..decks.len() {
                for seed in 0..3u64 {
                    let deck = |at: usize| Deck::from_string(decks[at]).expect("deck");
                    let mut game = Game::new(players(deck(a), deck(b), vec![PlayerCode::R, PlayerCode::R]), seed);
                    while !game.is_game_over() && game.get_state_clone().turn_count < 31 {
                        let state = game.get_state_clone();
                        let (actor, actions) = state.generate_possible_actions();
                        for action in actions.iter().filter(|action| matches!(action.action, SimpleAction::Attack(_))) {
                            let (_, mutations) = forecast_action(&state, action).into_branches();
                            for mutation in mutations {
                                let mut outcome = state.clone();
                                mutation(&mut StdRng::seed_from_u64(1), &mut outcome, action);
                                let ends = outcome.winner.is_none() && outcome.current_player == actor;
                                if !ends || !outcome.move_generation_stack.is_empty() {
                                    continue;
                                }
                                checked += 1;
                                let (next_actor, next) = outcome.generate_possible_actions();
                                if next_actor != actor || only_end_turn(&next).is_none() {
                                    other.push(format!("{:?} → {:?}", action.action, next));
                                }
                            }
                        }
                        game.play_tick();
                    }
                }
            }
        }
        assert!(checked > 1000, "only {checked} attacks");
        assert!(other.is_empty(), "{}", other.join("\n"));
    }

    #[test]
    fn a_choice_after_the_attack_is_made_before_its_value() {
        // Hoopa ex's Shadow Bullet (30, and 20 to a Benched Pokémon it picks) against a Dedenne ex with 30 HP left: the
        // engine holds back all its damage until the Benched target is picked. Valued before that choice, «attack now»
        // missed the knockout and its 2 points (Codex on #128).
        let hoopa = card("B4 103").with_energy(vec![EnergyType::Darkness]);
        let mut state = board(HYDREIGON, DEDENNE, vec![hoopa], vec![card("B3b 024").with_remaining_hp(30), card("A3 165")]);
        state.turn_count = 3;
        let now = g_value_function(&state, 0, &GParams::default());
        let stand = g_value_function(&state, 0, &GParams { attack_now: false, ..GParams::default() });
        assert!(now - stand > 10_000.0, "{now} vs {stand}");
    }

    #[test]
    fn a_spread_attack_wins_through_an_active_it_cannot_hurt() {
        // Articuno ex's Blizzard (80, and 10 to each Benched Pokémon) against Oricorio's Safeguard, with 2 points
        // already: the Active takes nothing, a 50-HP Caterpie on the Bench falls in 5 and gives the last point (Codex on
        // #128: no threat at all before).
        let articuno = card("A1 084").with_energy(vec![EnergyType::Water; 3]);
        let mut state = board(SUICUNE, VENUSAUR, vec![articuno], vec![card("A3 165"), card("A1 005")]);
        state.points = [2, 0];
        assert_eq!(turns(&state, 0, false), 5.0);
    }

    #[test]
    fn an_energy_threshold_can_take_two_more() {
        // Scrafty's Crush the Weak (50, 50 more with more Energy than the rival's Active), from a Scraggy with its [D][D]
        // and Scrafty in the deck, against a Mega Venusaur ex (240 HP) with 3 Energy. Evolving takes a turn anyway, so
        // one more Energy is free, but it ties at 3 and adds nothing; two make it 100. 1 + 5 hits, or 2 + 3 with the two
        // (Codex on #128: the clock stopped at the first that did not add).
        let dark = "Energy: Darkness\n2 Scraggy B2 106\n2 Scrafty B2 107\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n2 Giant Cape A2 147\n2 Rocky Helmet A2 148\n2 Lucky Ice Pop B2 145\n2 Cyrus A2 150\n2 Sabrina A1 225\n";
        let scraggy = card("B2 106").with_energy(vec![EnergyType::Darkness, EnergyType::Darkness]);
        let venusaur = card("B1a 004").with_energy(vec![EnergyType::Grass; 3]);
        let state = board(dark, VENUSAUR, vec![scraggy], vec![venusaur]);
        assert_eq!(turns(&state, 0, true), 2.0 + 3.0);
    }

    #[test]
    fn wild_spin_hits_the_bench_with_its_escalation() {
        use deckgym::actions::Action;
        // Archeops' Wild Spin: 20 to each of the rival's Pokémon, and 20 more on its next turn. The Benched ones take
        // the same as the Active, as the engine plays it (Codex on #128: the Bench stayed at 20).
        let archeops = card("B1 134").with_energy(vec![EnergyType::Fighting]);
        let mut state = board(LUCARIO, VENUSAUR, vec![archeops], vec![card("B1a 004"), card("B1a 004")]);
        state.turn_count = 3;
        let wild_spin = first_attack(state.in_play_pokemon[0][0].as_ref().expect("Archeops"));
        assert_eq!(bench_damage(&mut state.clone(), 0, &wild_spin, mechanic(&wild_spin), 1), 20.0);
        // A Benched Dedenne ex, weak to [F], takes no Weakness there: still 20 (Codex on #128).
        let mut weak = state.clone();
        weak.in_play_pokemon[1][1] = Some(card("B3b 024"));
        assert_eq!(bench_damage(&mut weak, 0, &wild_spin, mechanic(&wild_spin), 1), 20.0);
        let mut game = Game::from_state(state, Vec::new(), 3);
        game.apply_action(&Action { actor: 0, action: SimpleAction::Attack(wild_spin.clone()), is_stack: false });
        while game.get_state_clone().current_player != 0 || !game.get_state_clone().move_generation_stack.is_empty() {
            let state = game.get_state_clone();
            let (actor, actions) = state.generate_possible_actions();
            let end = actions.iter().find(|a| matches!(a.action, SimpleAction::EndTurn)).unwrap_or(&actions[0]).clone();
            assert_eq!(actor, end.actor);
            game.apply_action(&end);
        }
        let mut next = game.get_state_clone();
        let active = expected_attack_damage(&next, 0, &wild_spin, 1, 0);
        assert_eq!(active, 40.0);
        assert_eq!(bench_damage(&mut next, 0, &wild_spin, mechanic(&wild_spin), 1), 40.0);
    }

    #[test]
    fn hide_splits_what_is_left_over_the_hand_and_the_deck_together() {
        // 11 Trainers and 7 Pokémon shown: 1 and 1 left. With one card in the hand and one in the deck, one of them is a
        // Trainer, not both (Codex on #128).
        let mut state = board(DEDENNE, DEDENNE, vec![card("B3b 024")], vec![card("B3b 024")]);
        state.discard_piles[1] = std::iter::repeat_n(tool("P-A 007"), 11).chain(std::iter::repeat_n(tool("A1 005"), 6)).collect();
        state.hands[1] = vec![tool("P-A 005")];
        state.decks[1].cards.truncate(1);
        assert_eq!(shown(&state, 1), (11, 7));
        hide(&mut state, 1);
        let trainers = state.hands[1].iter().chain(&state.decks[1].cards).filter(|card| matches!(card, Card::Trainer(_))).count();
        assert_eq!(trainers, 1);
    }

    #[test]
    fn mega_burst_needs_all_its_energy_back_to_hit_as_hard() {
        // Mega Rayquaza ex with five [R]/[L] does 250 with Mega Burst and discards all five: to do 250 again it needs
        // all five back, not its cost of two (Codex on #128). Against two Dedenne ex: a hit each, 5 turns between.
        let rayquaza = card("B4 120").with_energy(vec![EnergyType::Fire, EnergyType::Fire, Lightning, Lightning, EnergyType::Fire]);
        let mega_burst = first_attack(&rayquaza);
        assert_eq!(self_discard(mechanic(&mega_burst), &rayquaza.attached_energy, 2), (5.0, 1.0));
        let state = board(DEDENNE, DEDENNE, vec![rayquaza], vec![card("B3b 024"), card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 2.0 + (5.0 - 1.0));
    }

    #[test]
    fn the_extra_energy_is_the_type_the_attack_asks_for() {
        // Medicham's Psykick ([F][C], 50 more with any [P]) with [F][F], and a zone that makes [F] and [P]: one more
        // [P] makes it 100 against a Mega Venusaur ex (240 HP), 1 + 3 turns; one more [F] left it at 50, 5 hits (Codex on
        // #128).
        let fighting_psychic = LUCARIO.replacen("Energy: Fighting", "Energy: Fighting, Psychic", 1);
        let medicham = card("B2 084").with_energy(vec![EnergyType::Fighting, EnergyType::Fighting]);
        let state = board(&fighting_psychic, VENUSAUR, vec![medicham], vec![card("B1a 004")]);
        assert_eq!(turns(&state, 0, false), 1.0 + 3.0);
    }

    #[test]
    fn evolving_into_serperior_brings_jungle_totem() {
        // A Snivy with no Energy and Servine and Serperior in the deck: Serperior's Solar Beam ([G][C][C][C], 70) is
        // ready with two [G] under its own Jungle Totem, as soon as it evolves twice; 2 + 2 hits against Dedenne ex
        // (Codex on #128: the four Energy without Totem made it 4 + 2, behind Servine's 2 + 3).
        let grass = "Energy: Grass\n2 Snivy A1a 4\n2 Servine A1a 5\n2 Serperior A1a 6\n2 Professor's Research P-A 7\n2 Poké Ball P-A 5\n2 Copycat B1 225\n2 Giant Cape A2 147\n2 Rocky Helmet A2 148\n2 Lucky Ice Pop B2 145\n2 Cyrus A2 150\n";
        let state = board(grass, DEDENNE, vec![card("A1a 004")], vec![card("B3b 024")]);
        assert_eq!(turns(&state, 0, true), 2.0 + 2.0);
    }

    #[test]
    fn can_attack_needs_the_energy_and_no_status_that_stops_it() {
        let latias = card("A4a 036");
        assert!(!can_attack(&board(MISMAGIUS, DEDENNE, vec![latias.clone()], vec![card("B3b 024")]), 0));
        let ready = board(MISMAGIUS, DEDENNE, vec![latias.with_energy(vec![Psychic])], vec![card("B3b 024")]);
        assert!(can_attack(&ready, 0));
        let mut asleep = ready.clone();
        asleep.apply_status_condition(0, 0, StatusCondition::Asleep);
        assert!(!can_attack(&asleep, 0));
    }

    #[test]
    fn an_attack_that_locks_itself_hits_every_other_turn() {
        // Necrozma's Prismatic Laser (120, cannot attack next turn) against two Dedenne ex (2 points each): a hit each,
        // a turn apart.
        let necrozma = card("A3 088").with_energy(vec![Psychic, Psychic, Psychic, Psychic]);
        let state = board(MISMAGIUS, DEDENNE, vec![necrozma], vec![card("B3b 024"), card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 2.0 + 1.0);
        assert_eq!(cooldown(mechanic(&first_attack(&card("A3a 006")))), 0.0);
        let big_beat = match &card("A3a 006").card {
            Card::Pokemon(pokemon) => pokemon.attacks[1].clone(),
            _ => unreachable!(),
        };
        assert_eq!(big_beat.title, "Big Beat");
        assert_eq!(cooldown(mechanic(&big_beat)), 1.0);
    }

    #[test]
    fn an_overcharged_attacker_gets_back_only_its_cost() {
        // Raichu's Thunderbolt (140, discard all Energy) with 5 Energy, against two Dedenne ex: it needs its 3 back
        // between the hits, not 5 (Codex on #117).
        let raichu = card("A1 095").with_energy(vec![EnergyType::Lightning; 5]);
        let state = board(DEDENNE, DEDENNE, vec![raichu], vec![card("B3b 024"), card("B3b 024")]);
        assert_eq!(turns(&state, 0, false), 2.0 + (3.0 - 1.0));
    }

    #[test]
    fn recoil_stops_a_plan_its_user_does_not_survive() {
        // Blacephalon's Beat Punk (130, 70 to itself) against Mega Absol ex (170 HP, 3 points): 2 hits. With 100 HP it
        // survives the first and lands the second; with 30 damage on it the first knocks it out (Codex on #117).
        let fresh = card("A3a 009").with_energy(vec![EnergyType::Fire; 3]);
        let hurt = card("A3a 009").with_energy(vec![EnergyType::Fire; 3]).with_damage(30);
        let healthy = board(DEDENNE, HYDREIGON, vec![fresh], vec![card("B1 151")]);
        let damaged = board(DEDENNE, HYDREIGON, vec![hurt], vec![card("B1 151")]);
        assert_eq!(turns(&healthy, 0, false), 2.0);
        assert_eq!(turns(&damaged, 0, false), NO_THREAT);
    }

    #[test]
    fn swirling_disaster_wears_the_bench_down_with_the_active() {
        // Spiritomb's Swirling Disaster (10 to each of the rival's Pokémon) against three 50-HP Pokémon of a point each:
        // they fall together after 5 hits, not one after the other after 15 (Codex on #117).
        let spiritomb = card("A2 104").with_energy(vec![Psychic]);
        let theirs = vec![card("A1 005"), card("A1 008"), card("A1 027")];
        let state = board(MISMAGIUS, VENUSAUR, vec![spiritomb], theirs);
        assert_eq!(turns(&state, 0, false), 5.0);
    }

    #[test]
    fn status_attacks_poison_and_burn_with_their_chance() {
        let attack_of = |id: &str| first_attack(&card(id));
        let inflicts = |attack: &Attack| inflicts(attack, mechanic(attack));
        // Stun Poison: on heads. Cross Poison: at least 2 heads of 4, 11/16. Singe: always burns.
        assert_eq!(inflicts(&attack_of("A4a 016")).poison, 0.5);
        assert_eq!(inflicts(&attack_of("A2 106")).poison, 11.0 / 16.0);
        let singe = inflicts(&attack_of("B2 023"));
        assert_eq!((singe.poison, singe.burn), (0.0, 1.0));
        assert_eq!(at_least_heads(2, 1), 0.75);
        // Singe does no damage: before, Blacephalon ex had no threat at all. Against Dedenne ex (120 HP) a burn round
        // each turn: 4 turns.
        let blacephalon = card("B2 023").with_energy(vec![EnergyType::Fire]);
        let state = board(DEDENNE, DEDENNE, vec![blacephalon.clone()], vec![card("B3b 024")]);
        assert_eq!(damage(&mut state.clone(), 0, &first_attack(&blacephalon), 0, 0.0), BURN_ROUND);
        assert_eq!(turns(&state, 0, false), 4.0);
        // Once Dedenne is Burned, Singe keeps it burning: still a round each turn, not «no threat» (review of g 1.1).
        let mut burned = state.clone();
        burned.apply_status_condition(1, 0, StatusCondition::Burned);
        assert_eq!(damage(&mut burned.clone(), 0, &first_attack(&blacephalon), 0, 0.0), BURN_ROUND);
        assert_eq!(turns(&burned, 0, false), 4.0);
        // Only the first attack after coming into play: Iron Bundle ex's Cold Start is not a status hit after hit.
        let cold_start = first_attack(&card("B3a 013"));
        assert_eq!(inflicts(&cold_start), inflicts(&first_attack(&card("A1 001"))));
    }

    /// Every attack text that poisons or burns, played by the engine on a board: the chance `inflicts` gives is the
    /// share of the outcomes that leave the defender Poisoned or Burned.
    #[test]
    fn inflicted_status_is_what_the_engine_does() {
        use deckgym::actions::{forecast_action, SimpleAction};
        use rand::rngs::StdRng;
        use rand::SeedableRng;
        use strum::IntoEnumIterator;
        let mut texts: Vec<String> = Vec::new();
        let (mut checked, mut differ) = (0, Vec::new());
        for id in deckgym::card_ids::CardId::iter() {
            let Card::Pokemon(pokemon) = get_card_by_enum(id) else { continue };
            for attack in &pokemon.attacks {
                let Some(effect) = attack.effect.as_deref() else { continue };
                if !(effect.contains("Poisoned") || effect.contains("Burned")) || texts.iter().any(|t| t == effect) {
                    continue;
                }
                texts.push(effect.to_string());
                let energy: Vec<EnergyType> = attack
                    .energy_required
                    .iter()
                    .map(|e| if *e == EnergyType::Colorless { pokemon.energy_type } else { *e })
                    .collect();
                let attacker = PlayedCard::from_id(id).with_energy(energy);
                // Mega Venusaur ex (240 HP) takes the hit and stays.
                let mut state = board(DEDENNE, VENUSAUR, vec![attacker], vec![card("B1a 004")]);
                state.turn_count = 3;
                let (_, actions) = state.generate_possible_actions();
                let Some(action) = actions.iter().find(|a| matches!(&a.action, SimpleAction::Attack(played) if played.title == attack.title)) else {
                    continue;
                };
                // Each outcome many times over, for one that picks its status at random (Chemical Panic), and the
                // status the attacker would pick when it asks (Select Powder: burn over poison, as `inflicts`).
                const SEEDS: u64 = 256;
                let (mut poison, mut burn) = (0.0, 0.0);
                for seed in 0..SEEDS {
                    let (probabilities, mutations) = forecast_action(&state, action).into_branches();
                    for (probability, mutation) in probabilities.iter().zip(mutations) {
                        let mut outcome = state.clone();
                        mutation(&mut StdRng::seed_from_u64(seed), &mut outcome, action);
                        let status = |state: &State| {
                            let defender = state.in_play_pokemon[1][0].as_ref().expect("still in play");
                            (f64::from(u8::from(defender.is_poisoned())), f64::from(u8::from(defender.is_burned())))
                        };
                        let (p, b) = match outcome.move_generation_stack.last() {
                            Some((0, choices)) => choices
                                .iter()
                                .map(|choice| {
                                    let mut chosen = outcome.clone();
                                    chosen.move_generation_stack.pop();
                                    let mut game = Game::from_state(chosen, Vec::new(), seed);
                                    game.apply_action(&deckgym::actions::Action { actor: 0, action: choice.clone(), is_stack: true });
                                    status(&game.get_state_clone())
                                })
                                .fold((0.0, 0.0), |best, (p, b)| if POISON_ROUND * p + BURN_ROUND * b > POISON_ROUND * best.0 + BURN_ROUND * best.1 { (p, b) } else { best }),
                            _ => status(&outcome),
                        };
                        poison += probability * p / SEEDS as f64;
                        burn += probability * b / SEEDS as f64;
                    }
                }
                checked += 1;
                let ours = inflicts(attack, mechanic(attack));
                if (ours.poison - poison).abs() > 0.08 || (ours.burn - burn).abs() > 0.08 {
                    differ.push(format!("{}: ours {:?}, engine poison {poison} burn {burn}", attack.title, ours));
                }
            }
        }
        assert!(checked >= 18, "only {checked} of {} texts checked", texts.len());
        assert!(differ.is_empty(), "{} of {checked} differ:\n{}", differ.len(), differ.join("\n"));
    }

    #[test]
    fn cyberjack_counts_the_trainers_a_list_still_has() {
        // Porygon-Z's Cyberjack: 20 more for each Trainer in the rival's deck. Hidden, the 20 cards of the rival (one
        // Pokémon in play) were all Trainers for it: 420. A list of the bank still has 12 Trainers of its other 19
        // cards: 13 of the 20 (Codex on #117).
        let porygon = card("B1a 058").with_energy(vec![EnergyType::Colorless; 3]);
        let mut state = board(DEDENNE, DEDENNE, vec![porygon.clone()], vec![card("B3b 024")]);
        state.decks[1].cards.truncate(20);
        hide(&mut state, 1);
        let trainers = state.decks[1].cards.iter().filter(|c| matches!(c, Card::Trainer(_))).count();
        assert_eq!(trainers, 13);
        assert_eq!(damage(&mut state, 0, &first_attack(&porygon), 0, 0.0), 20.0 + 13.0 * 20.0);
    }
}

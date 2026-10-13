//! Seeds and the games revision: game `i` of a job plays with `splitmix64(seed ^ splitmix64(i))` (see main.rs), and
//! `GAMES_REV` says how games play. Shared with the engine of the browser (`engine/wasm`, T-015), whose coach draws
//! its samples the same way and whose games carry the same revision (they are not a PC's games, R-003, but they change
//! when engine-cli's do: the same bots, coach and game rules).

pub fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Seed of game `index` of a job with seed `seed`.
pub fn game_seed(seed: u64, index: u64) -> u64 {
    splitmix64(seed ^ splitmix64(index))
}

/// How games play (phase 42): a job is played whole with one value, and the queue gives its chunks only to engines
/// with the same deckgym and the same `GAMES_REV` (a job of an old one is played again whole).
///
/// Raise it when the code changes how something that already existed plays: the rules engine-cli adds over deckgym,
/// a bot that was already there (its search, its value function, its clock), how seeds become games, how a deck is
/// built from its text, what a consistency or an optimize run counts. Do not raise it for what plays nothing new:
/// a new bot or command, a new field in a result, speed, batching, logging. The golden games (games_rev_tests.rs,
/// games-rev.json) fail when results change without raising it; after raising it, make the file again.
/// 1: engine-cli 0.3.3 on (the f bots' clock, a574691); engines before it play otherwise.
pub const GAMES_REV: u32 = 1;

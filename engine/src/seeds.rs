//! Seeds: game `i` of a job plays with `splitmix64(seed ^ splitmix64(i))` (see main.rs). Shared with the engine of the
//! browser (`engine/wasm`, T-015), whose coach draws its samples the same way.

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

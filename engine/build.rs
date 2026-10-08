//! Exposes the pinned deckgym revision (from Cargo.toml) as `DECKGYM_REV`, so every result names the engine it came
//! from without a second place to update.

fn main() {
    println!("cargo:rerun-if-changed=Cargo.toml");
    let manifest = std::fs::read_to_string("Cargo.toml").expect("Cargo.toml");
    let rev = manifest
        .lines()
        .find(|line| line.trim_start().starts_with("deckgym"))
        .and_then(|line| line.split("rev = \"").nth(1))
        .and_then(|rest| rest.split('"').next())
        .expect("deckgym must be pinned with rev = \"<sha>\"");
    println!("cargo:rustc-env=DECKGYM_REV={rev}");
}

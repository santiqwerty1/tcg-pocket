//! Exposes the pinned deckgym revision as `DECKGYM_REV`, and refuses to build when it is not engine-cli's: the browser
//! must play the same engine as the workers (T-015: every runner takes only games of its engine revision).

fn rev_of(path: &str) -> String {
    let manifest = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    manifest
        .lines()
        .find(|line| line.trim_start().starts_with("deckgym"))
        .and_then(|line| line.split("rev = \"").nth(1))
        .and_then(|rest| rest.split('"').next())
        .map(str::to_string)
        .unwrap_or_else(|| panic!("{path}: deckgym must be pinned with rev = \"<sha>\""))
}

fn main() {
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../Cargo.toml");
    let own = rev_of("Cargo.toml");
    let cli = rev_of("../Cargo.toml");
    assert_eq!(own, cli, "engine/wasm/Cargo.toml pins deckgym {own}, engine/Cargo.toml pins {cli}: use the same rev");
    println!("cargo:rustc-env=DECKGYM_REV={own}");
}

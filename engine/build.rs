//! Exposes the pinned deckgym revision (from Cargo.toml) as `DECKGYM_REV`, so every result names the engine it came
//! from without a second place to update; and `ENGINE_BUILD`, a fingerprint of the code that plays (phase 42, the
//! exact cache of chunks): two engines with the same fingerprint play the same games, whatever the version says.

use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=Cargo.lock");
    println!("cargo:rerun-if-changed=src");
    let manifest = std::fs::read_to_string("Cargo.toml").expect("Cargo.toml");
    let rev = manifest
        .lines()
        .find(|line| line.trim_start().starts_with("deckgym"))
        .and_then(|line| line.split("rev = \"").nth(1))
        .and_then(|rest| rest.split('"').next())
        .expect("deckgym must be pinned with rev = \"<sha>\"");
    println!("cargo:rustc-env=DECKGYM_REV={rev}");
    println!("cargo:rustc-env=ENGINE_BUILD={}", fingerprint());
}

/// Without carriage returns: a Windows checkout and a Linux one of the same commit read the same bytes.
fn lf(bytes: Vec<u8>) -> Vec<u8> {
    bytes.into_iter().filter(|byte| *byte != b'\r').collect()
}

/// FNV-1a (64 bits) over the compiler (`rustc -vV`) and the target, then the sources, the manifest and the lock file
/// (paths sorted, line ends as LF). The same commit gives the same value with the same compiler and target. Another
/// compiler or target is another build: Rust has changed the order of equal elements when sorting between versions,
/// and two such engines could play other games. Not a security hash: it only tells builds apart.
fn fingerprint() -> String {
    let mut files: Vec<PathBuf> = vec![PathBuf::from("Cargo.toml"), PathBuf::from("Cargo.lock")];
    collect(Path::new("src"), &mut files);
    files.sort();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
    let compiler = std::process::Command::new(rustc)
        .arg("-vV")
        .output()
        .map(|output| output.stdout)
        .unwrap_or_default();
    feed(&lf(compiler));
    feed(&[0]);
    feed(std::env::var("TARGET").unwrap_or_default().as_bytes());
    feed(&[0]);
    for file in files {
        let name = file.to_string_lossy().replace('\\', "/");
        feed(name.as_bytes());
        feed(&[0]);
        feed(&lf(std::fs::read(&file).unwrap_or_default()));
        feed(&[0]);
    }
    format!("{hash:016x}")
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

//! engine-cli says how it ends as its last stderr line (src/exit.rs, H-054): the worker logs it when a result is
//! missing, so a cut from outside (the S25) is told apart from an end of its own.

use std::process::Command;

fn engine() -> Command {
    Command::new(env!("CARGO_BIN_EXE_engine-cli"))
}

fn last_line(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr).lines().last().unwrap_or("").to_string()
}

#[test]
fn a_normal_end_says_ok() {
    let out = engine().arg("version").output().expect("engine-cli");
    assert!(out.status.success());
    assert_eq!(last_line(&out.stderr), "fin ok");
}

#[test]
fn an_error_says_its_exit_code() {
    let out = engine().arg("no-existe").output().expect("engine-cli");
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(last_line(&out.stderr), "fin error 2");
}

#[cfg(unix)]
#[test]
fn a_signal_says_its_number_and_still_ends_the_process_with_it() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::process::ExitStatusExt;
    use std::process::Stdio;

    const DECK: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64";
    let dir = std::env::temp_dir().join(format!("engine-cli-exit-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let job = dir.join("job.json");
    // Far more games than it plays before the signal.
    let text = serde_json::json!({ "deckA": DECK, "deckB": DECK, "players": ["e2", "e2"], "games": 100000, "seed": 7 });
    std::fs::write(&job, text.to_string()).expect("job");
    let mut child = engine()
        .arg("simulate")
        .arg(&job)
        .arg(dir.join("result.json"))
        .stderr(Stdio::piped())
        .spawn()
        .expect("engine-cli");
    let mut lines = BufReader::new(child.stderr.take().expect("stderr")).lines();
    // Playing: its first progress past 0.
    for line in lines.by_ref() {
        let line = line.expect("line");
        if line.starts_with("progress ") && line != "progress 0" {
            break;
        }
    }
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    let rest: Vec<String> = lines.map(|line| line.expect("line")).collect();
    let status = child.wait().expect("wait");
    assert_eq!(status.signal(), Some(libc::SIGTERM), "it still dies of the signal");
    assert_eq!(rest.last().map(String::as_str), Some("fin señal 15"));
    assert!(!dir.join("result.json").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

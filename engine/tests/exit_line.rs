//! engine-cli says how it ends as its last stderr line (src/exit.rs, H-054): the worker logs it when a result is
//! missing, so a cut from outside (the S25) is told apart from an end of its own.

use std::process::{Command, Stdio};

const DECK: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64";

fn engine() -> Command {
    Command::new(env!("CARGO_BIN_EXE_engine-cli"))
}

fn last_line(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr).lines().last().unwrap_or("").to_string()
}

/// A folder of its own for a test's job.
fn work_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("engine-cli-exit-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    dir
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

/// A panic outside a game: `status` writes ~300 KB to a stdout nobody reads, and `println!` panics on the broken pipe.
#[test]
fn a_panic_outside_a_game_says_so_and_exits_101() {
    let mut child = engine().arg("status").stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("engine-cli");
    drop(child.stdout.take());
    let out = child.wait_with_output().expect("engine-cli");
    assert_eq!(out.status.code(), Some(101));
    assert_eq!(last_line(&out.stderr), "fin pánico");
}

/// `engine-cli play` asks over stdin: closed, nobody will answer, and it ends with 4.
#[test]
fn a_live_game_nobody_answers_ends_with_4() {
    let dir = work_dir("play");
    let job = dir.join("job.json");
    let text = serde_json::json!({ "deckHuman": DECK, "deckBot": DECK, "bot": "r", "seed": 3 });
    std::fs::write(&job, text.to_string()).expect("job");
    let out = engine().arg("play").arg(&job).stdin(Stdio::null()).output().expect("engine-cli");
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(out.status.code(), Some(4));
    assert_eq!(last_line(&out.stderr), "fin error 4");
}

#[cfg(unix)]
#[test]
fn a_signal_says_its_number_and_still_ends_the_process_with_it() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::process::ExitStatusExt;
    use std::time::{Duration, Instant};

    let dir = work_dir("signal");
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
    let pid = child.id() as libc::pid_t;
    // Its stderr on a thread of its own: the test gives up after a deadline instead of hanging.
    let stderr = child.stderr.take().expect("stderr");
    let (sender, lines) = std::sync::mpsc::channel::<String>();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut seen = Vec::new();
    // Playing: its first progress past 0, then the signal.
    while Instant::now() < deadline {
        if let Ok(line) = lines.recv_timeout(Duration::from_millis(200)) {
            let playing = line.starts_with("progress ") && line != "progress 0";
            seen.push(line);
            if playing {
                break;
            }
        }
    }
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    let status = loop {
        if let Some(status) = child.try_wait().expect("wait") {
            break status;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("engine-cli did not end after SIGTERM");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let _ = reader.join();
    seen.extend(lines.try_iter());
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(status.signal(), Some(libc::SIGTERM), "it still dies of the signal");
    assert_eq!(seen.iter().rev().find(|line| !line.is_empty()).map(String::as_str), Some("fin señal 15"));
}

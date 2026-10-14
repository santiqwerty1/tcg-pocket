//! `resume` (H-054): an engine-cli killed halfway through a pairing and run again with the same job and checkpoint
//! writes byte for byte the result.json of a run in one go, but for `durationMs`.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const DECK: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64";
const GAMES: u32 = 160;

fn engine() -> Command {
    Command::new(env!("CARGO_BIN_EXE_engine-cli"))
}

/// The result's text with its `durationMs` at 0 (the time is never the same).
fn without_duration(text: &str) -> String {
    let key = "\"durationMs\":";
    let at = text.find(key).expect("durationMs") + key.len();
    let end = at + text[at..].find(|c: char| !c.is_ascii_digit()).expect("end");
    format!("{}0{}", &text[..at], &text[end..])
}

fn write_job(dir: &Path, checkpoint: Option<&Path>) -> std::path::PathBuf {
    std::fs::create_dir_all(dir).expect("dir");
    let mut job = serde_json::json!({
        "deckA": DECK, "deckB": DECK, "players": ["e2", "e2"], "games": GAMES, "seed": 11, "threads": 2, "perGame": true,
    });
    if let Some(path) = checkpoint {
        job["checkpoint"] = serde_json::json!(path.display().to_string());
    }
    let file = dir.join("job.json");
    std::fs::write(&file, job.to_string()).expect("job");
    file
}

fn run_to_the_end(job: &Path, result: &Path) -> String {
    let out = engine().arg("simulate").arg(job).arg(result).output().expect("engine-cli");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    std::fs::read_to_string(result).expect("result")
}

#[test]
fn killed_halfway_and_run_again_it_writes_the_result_of_one_run() {
    let root = std::env::temp_dir().join(format!("engine-cli-resume-kill-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let once = run_to_the_end(&write_job(&root.join("once"), None), &root.join("once").join("result.json"));

    let dir = root.join("cut");
    let checkpoint = dir.join("progress.txt");
    let job = write_job(&dir, Some(&checkpoint));
    let result = dir.join("result.json");
    let mut child = engine().arg("simulate").arg(&job).arg(&result).stderr(Stdio::piped()).spawn().expect("engine-cli");
    let stderr = child.stderr.take().expect("stderr");
    let (sender, lines) = std::sync::mpsc::channel::<u32>();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(done) = line.strip_prefix("progress ").and_then(|n| n.parse().ok()) {
                if sender.send(done).is_err() {
                    break;
                }
            }
        }
    });
    // Killed (SIGKILL; TerminateProcess on Windows) once it played some of its games, without a chance to say so.
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut done = 0;
    while done < GAMES / 4 && Instant::now() < deadline {
        if let Ok(now) = lines.recv_timeout(Duration::from_millis(200)) {
            done = now;
        }
    }
    child.kill().expect("kill");
    let _ = child.wait();
    assert!(!result.exists(), "it was killed before its end");
    let kept = std::fs::read_to_string(&checkpoint).expect("checkpoint").lines().count() - 1;
    assert!(kept > 0 && kept < GAMES as usize, "the checkpoint has some of the games ({kept})");

    let resumed = run_to_the_end(&job, &result);
    assert_eq!(without_duration(&resumed), without_duration(&once));
    let _ = std::fs::remove_dir_all(&root);
}

//! The CPU regulator on Windows (`engine-cli regulate`, src/regulate.rs): an engine it is told of runs within what it
//! allows, and when its stdin ends the engine gets the whole machine back and the regulator ends.
#![cfg(windows)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{GetProcessAffinityMask, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

const DECK: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64";

fn engine() -> Command {
    Command::new(env!("CARGO_BIN_EXE_engine-cli"))
}

/// A process's affinity mask and the system's.
fn affinity(pid: u32) -> (usize, usize) {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    assert!(!handle.is_null(), "open {pid}");
    let (mut process, mut system) = (0usize, 0usize);
    unsafe {
        GetProcessAffinityMask(handle, &mut process, &mut system);
        CloseHandle(handle);
    }
    (process, system)
}

fn until(what: &str, check: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !check() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Kills what a test started, also when one of its asserts fails: else cargo waits for the busy engine to end.
struct Reap(Vec<std::process::Child>);

impl Drop for Reap {
    fn drop(&mut self) {
        for child in &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[test]
fn a_regulated_engine_runs_within_what_it_allows_and_gets_the_machine_back_at_the_end() {
    let dir = std::env::temp_dir().join(format!("engine-cli-regulate-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let job = dir.join("job.json");
    let text = serde_json::json!({ "deckA": DECK, "deckB": DECK, "players": ["e2", "e2"], "games": 100000, "seed": 5, "threads": 2 });
    std::fs::write(&job, text.to_string()).expect("job");
    // Two busy engines, as the worker starts them: one for a job, one for a live game (never narrowed).
    let busy_engine = |name: &str| {
        engine()
            .arg("simulate")
            .arg(&job)
            .arg(dir.join(name))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("engine")
    };
    let busy = busy_engine("result.json");
    let live = busy_engine("live.json");
    let mut regulator = engine()
        .args(["regulate", "--max", "4", "--every-ms", "200"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("regulator");
    let mut stdin = regulator.stdin.take().expect("stdin");
    let stdout = regulator.stdout.take().expect("stdout");
    let said = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let reader = {
        let said = said.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                said.lock().unwrap().push(line);
            }
        })
    };
    let (busy_id, live_id) = (busy.id(), live.id());
    let mut children = Reap(vec![busy, live, regulator]);
    let mut tell = |line: String| {
        writeln!(stdin, "{line}").expect("write");
        stdin.flush().expect("flush");
    };
    // A PID that is not an engine (this test's own process): never touched (autorrevisión).
    let me = std::process::id();
    let mine = affinity(me).0;
    tell(format!("add {me} managed"));
    tell(format!("add {live_id} own"));
    tell(format!("add {busy_id} managed"));
    let (_, system) = affinity(busy_id);
    // At most 4 logical processors (whole cores): never the whole machine on a machine with more than 4.
    let narrowed = || {
        let (mask, _) = affinity(busy_id);
        mask.count_ones() <= 4 && mask != 0
    };
    until("the engine is narrowed", narrowed);
    if system.count_ones() > 4 {
        assert_ne!(affinity(busy_id).0, system);
    }
    assert_eq!(affinity(me).0, mine, "a process that is not an engine keeps its mask");
    // A live game's engine is counted as ours but never narrowed (review of #106, M4).
    assert_eq!(affinity(live_id).0, system, "an own engine keeps the whole machine");
    // It answers the worker's check (review of #106: a hung regulator).
    tell("ping".to_string());
    until("pong", || said.lock().unwrap().iter().any(|line| line == "pong"));
    // An engine removed while it still runs gets the whole machine back (review of #106: a PID reused by a live game).
    tell(format!("remove {busy_id}"));
    until("the removed engine gets the machine back", || affinity(busy_id).0 == system);
    tell(format!("add {busy_id} managed"));
    until("the engine is narrowed again", narrowed);
    assert_eq!(affinity(live_id).0, system, "an own engine keeps the whole machine");
    // The worker goes away: the engine gets the whole machine back, and the regulator ends.
    drop(tell);
    drop(stdin);
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        if let Some(status) = children.0[2].try_wait().expect("wait") {
            break status;
        }
        assert!(Instant::now() < deadline, "the regulator did not end");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(status.success());
    assert_eq!(affinity(busy_id).0, system, "the whole machine back");
    let _ = reader.join();
    let said = said.lock().unwrap().clone();
    assert!(said.first().is_some_and(|line| line.starts_with("regulador ")), "{said:?}");
    assert!(said.iter().any(|line| line == &format!("aviso {me} no es un motor: no lo toco")), "{said:?}");
    assert_eq!(said.iter().rev().find(|line| line.starts_with("regulador ")).map(String::as_str), Some("regulador terminado"));
    drop(children);
    let _ = std::fs::remove_dir_all(&dir);
}

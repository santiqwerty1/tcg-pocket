//! The browser's game plays engine-cli's: the golden live games of engine/games-rev.json (played there through
//! `run_live_game`) come out the same through the stepper, natively (T-015). In WebAssembly they would not (R-003).

use engine_wasm::{PlayJob, Stepper};
use serde_json::Value;

/// engine-cli's games_rev_tests hash (FNV-1a, 64 bits).
fn fnv(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn cases(command: &str) -> Vec<Value> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../games-rev.json");
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("games-rev.json")).expect("JSON");
    golden["cases"].as_array().expect("cases").iter().filter(|case| case["command"] == command).cloned().collect()
}

fn job(case: &Value, coach: bool) -> PlayJob {
    let job = &case["job"];
    PlayJob {
        deck_human: job["deckHuman"].as_str().expect("deckHuman").to_string(),
        deck_bot: job["deckBot"].as_str().expect("deckBot").to_string(),
        bot: job["bot"].as_str().expect("bot").to_string(),
        seed: job["seed"].as_u64().expect("seed").to_string(),
        coach,
    }
}

#[test]
fn the_golden_live_games_come_out_the_same() {
    let cases = cases("play");
    assert!(cases.len() >= 3, "play cases in games-rev.json");
    for case in cases {
        let choices: Vec<usize> =
            case["job"]["choices"].as_array().expect("choices").iter().map(|c| c.as_u64().unwrap() as usize).collect();
        let mut stepper = Stepper::new(job(&case, false)).expect("stepper");
        let mut moves = Vec::new();
        let mut next = 0usize;
        let mut step = stepper.advance(None).expect("first step");
        loop {
            for line in step["log"].as_array().expect("log") {
                moves.push(format!("{}:{}", line["actor"], line["text"].as_str().expect("text")));
            }
            if step["type"] == "end" {
                break;
            }
            // As the golden asks: the k-th choice (cycling) modulo the options, answered with the option's label.
            let actions = step["actions"].as_array().expect("actions");
            let pick = choices[next % choices.len()] % actions.len();
            next += 1;
            let label = actions[pick]["i"].as_u64().expect("label") as usize;
            let shown = actions[pick]["text"].as_str().expect("text").to_string();
            step = stepper.advance(Some(label)).expect("step");
            // The move played is the one the owner was shown with that label (review of #86: the numbering of the
            // options and the moves must not drift apart).
            let played = &step["log"].as_array().expect("log")[0];
            assert_eq!(played["actor"], 0, "the owner's move comes first");
            assert_eq!(played["text"].as_str(), Some(shown.as_str()), "the move played is the one shown");
        }
        let expected = &case["expected"];
        assert_eq!(step["winner"], expected["winner"], "winner of {}", case["job"]["bot"]);
        assert_eq!(step["turns"], expected["turns"], "turns of {}", case["job"]["bot"]);
        assert_eq!(fnv(&moves.join("\n")), expected["moves"].as_str().unwrap(), "moves of {}", case["job"]["bot"]);
    }
}

#[test]
fn the_golden_coach_values_come_out_the_same() {
    let cases = cases("coach");
    assert!(!cases.is_empty(), "coach cases in games-rev.json");
    for case in cases {
        let mut stepper = Stepper::new(job(&case, true)).expect("stepper");
        assert_eq!(stepper.advance(None).expect("first step")["type"], "decide");
        let coach = stepper.coach().expect("coach");
        assert_eq!(coach["scores"], case["expected"]["scores"]);
        assert_eq!(coach["best"], case["expected"]["best"]);
    }
}

//! The browser's game, natively: the same code the WebAssembly module runs (T-015).

use engine_wasm::{PlayJob, Stepper};
use serde_json::Value;

const ALTARIA: &str = "Energy: Psychic
2 Swablu A4a 64
2 Mega Altaria ex B1 102
1 Jirachi B1 106
2 Chingling B1 109
1 Indeedee ex B1 121
1 Altaria B1 197
1 Sabrina A1 225
2 Rocky Helmet A2 148
1 Cyrus A2 150
1 Mars A2 155
1 Poké Ball A2b 111
2 Professor's Research A4b 373
1 Copycat B1 225
2 Lisia B1 226";

const VENUSAUR: &str = "Energy: Grass\n1 Bulbasaur A1 1\n2 Ivysaur B1a 2\n2 Mega Venusaur ex B1a 4\n2 Professor's Research P-A 7\n2 Copycat B1 225\n2 Quick-Grow Extract B1a 67\n2 Lucky Ice Pop B2 145\n2 Heavy Helmet B1 219\n1 Lillie A3 155\n1 Pokémon Center Lady A2b 70\n1 Cyrus A2 150\n1 Field Blower B3 147\n1 Repel A3a 64\n";

fn job(bot: &str, seed: &str, coach: bool) -> PlayJob {
    PlayJob {
        deck_human: VENUSAUR.to_string(),
        deck_bot: ALTARIA.to_string(),
        bot: bot.to_string(),
        seed: seed.to_string(),
        coach,
    }
}

/// The owner's stand-in: a fixed pick per decision that still varies from one decision to the next.
fn pick(ply: u64, options: usize) -> usize {
    ((ply * 7 + 3) % options as u64) as usize
}

struct Played {
    choices: Vec<usize>,
    log: Vec<Value>,
    end: Value,
    replay: String,
}

/// Plays a whole game: the first `known` choices come from `given`, the rest from `pick`.
fn play(stepper: &mut Stepper, given: &[usize]) -> Played {
    let mut choices = Vec::new();
    let mut log = Vec::new();
    let mut step = stepper.advance(None).expect("first step");
    loop {
        log.extend(step["log"].as_array().expect("log").iter().cloned());
        if step["type"] == "end" {
            break;
        }
        assert_eq!(step["type"], "decide");
        let ply = step["ply"].as_u64().expect("ply");
        assert_eq!(ply as usize, choices.len() + 1, "plies count the owner's decisions");
        let options = step["actions"].as_array().expect("actions").len();
        assert!(options > 1, "a forced move is never asked");
        let choice = given.get(choices.len()).copied().unwrap_or_else(|| pick(ply, options));
        choices.push(choice);
        step = stepper.advance(Some(choice)).expect("advance");
    }
    let replay = stepper.replay().expect("replay at the end");
    Played { choices, log, end: step, replay }
}

#[test]
fn a_whole_game_ends_with_its_replay_and_log() {
    let mut stepper = Stepper::new(job("e2", "20261011", false)).expect("stepper");
    assert_eq!(stepper.info()["type"], "start");
    assert_eq!(stepper.info()["engineRev"], engine_wasm::ENGINE_REV);
    assert_eq!(stepper.replay(), None, "no replay before the end");
    let played = play(&mut stepper, &[]);
    assert!(["you", "bot", "tie"].contains(&played.end["winner"].as_str().expect("winner")));
    assert!(played.end["turns"].as_u64().expect("turns") >= 1);
    assert!(!played.choices.is_empty());
    let replay: Value = serde_json::from_str(&played.replay).expect("replay JSON");
    let steps = replay["steps"].as_array().expect("steps");
    assert_eq!(steps.len(), played.log.len(), "one replay step per action");
    assert_eq!(replay["players"][0]["name"], "Santi");
    assert_eq!(replay["players"][1]["name"], "bot e2");
    assert!(replay["final_state"].is_object());
    // The owner's actions carry the ply of their decision, like engine-cli's log.
    let owner_decided: Vec<u64> = played
        .log
        .iter()
        .filter(|entry| entry["actor"] == 0 && entry["forced"] == false)
        .map(|entry| entry["ply"].as_u64().expect("ply"))
        .collect();
    assert_eq!(owner_decided, (1..=played.choices.len() as u64).collect::<Vec<_>>());
    // After the end: the same end again, with nothing new in the log; no more choices.
    let again = stepper.advance(None).expect("end again");
    assert_eq!(again["winner"], played.end["winner"]);
    assert_eq!(again["log"], serde_json::json!([]));
    assert!(stepper.advance(Some(0)).is_err());
}

#[test]
fn the_same_seed_and_choices_rebuild_the_same_game() {
    // What the page does after an undo or a reload: a new stepper fed the choices the server kept.
    let first = play(&mut Stepper::new(job("e2", "77", false)).expect("stepper"), &[]);
    let rebuilt = play(&mut Stepper::new(job("e2", "77", false)).expect("stepper"), &first.choices);
    assert_eq!(rebuilt.choices, first.choices);
    assert_eq!(rebuilt.log, first.log);
    assert_eq!(rebuilt.end, first.end);
    assert_eq!(rebuilt.replay, first.replay);
    // Going back three decisions and choosing again from there: the first part is the same game.
    let keep = first.choices.len().saturating_sub(3);
    let mut branch_given = first.choices[..keep].to_vec();
    let decision = keep as u64 + 1;
    let mut stepper = Stepper::new(job("e2", "77", false)).expect("stepper");
    let mut step = stepper.advance(None).expect("first step");
    for &choice in &first.choices[..keep] {
        step = stepper.advance(Some(choice)).expect("replayed choice");
    }
    assert_eq!(step["type"], "decide");
    assert_eq!(step["ply"].as_u64(), Some(decision));
    let options = step["actions"].as_array().expect("actions").len();
    branch_given.push((first.choices[keep] + 1) % options);
    let branch = play(&mut Stepper::new(job("e2", "77", false)).expect("stepper"), &branch_given);
    assert_eq!(branch.choices[..keep], first.choices[..keep]);
}

#[test]
fn every_bot_plays_a_game_and_another_seed_another_game() {
    for bot in ["r", "e2", "f2"] {
        let played = play(&mut Stepper::new(job(bot, "5", false)).expect(bot), &[]);
        assert_eq!(played.end["type"], "end", "{bot}");
    }
    let a = play(&mut Stepper::new(job("e2", "1", false)).expect("stepper"), &[]);
    let b = play(&mut Stepper::new(job("e2", "2", false)).expect("stepper"), &[]);
    assert_ne!(a.log, b.log);
}

#[test]
fn the_coach_scores_the_pending_decision_and_its_values_survive_a_rebuild() {
    let mut stepper = Stepper::new(job("e2", "3", true)).expect("stepper");
    assert_eq!(stepper.info()["coach"], true);
    let step = stepper.advance(None).expect("first decision");
    let options = step["actions"].as_array().expect("actions").len();
    let coach = stepper.coach().expect("coach");
    let scores = coach["scores"].as_array().expect("scores");
    assert_eq!(scores.len(), options);
    assert!(coach["best"].as_u64().expect("best") < options as u64);
    // Computed once: asking again gives the same values.
    assert_eq!(stepper.coach().expect("coach again"), coach);
    let values: Vec<f64> = coach["values"].as_array().expect("values").iter().map(|v| v.as_f64().expect("f64")).collect();
    let first = play(&mut stepper, &[]);

    // A rebuilt game restores the values instead of scoring again: the replay is the same.
    let mut rebuilt = Stepper::new(job("e2", "3", true)).expect("stepper");
    rebuilt.advance(None).expect("first decision");
    assert!(rebuilt.restore_coach(vec![1.0]).is_err(), "values of another decision");
    rebuilt.restore_coach(values).expect("restore");
    let second = play(&mut rebuilt, &first.choices);
    let step_scores = |replay: &str| -> Value {
        let replay: Value = serde_json::from_str(replay).expect("replay");
        replay["steps"]
            .as_array()
            .expect("steps")
            .iter()
            .find(|step| step["actor"] == 0 && step["options"].as_array().map_or(0, Vec::len) > 1)
            .expect("the owner's first decision")["scores"]
            .clone()
    };
    assert!(step_scores(&first.replay).is_array());
    assert_eq!(step_scores(&first.replay), step_scores(&second.replay));
}

#[test]
fn bad_input_is_refused_without_losing_the_decision() {
    assert!(Stepper::new(job("h", "1", false)).is_err(), "a human is no rival");
    assert!(Stepper::new(job("e2", "-4", false)).is_err(), "bad seed");
    assert!(Stepper::new(PlayJob { deck_human: "Energy: Grass\n1 Bulbasaur A1 1\n".to_string(), ..job("e2", "1", false) })
        .is_err());
    let mut stepper = Stepper::new(job("e2", "9", false)).expect("stepper");
    assert!(stepper.advance(Some(0)).is_err(), "nothing to answer yet");
    assert!(stepper.coach().is_err(), "no coach in this game");
    let step = stepper.advance(None).expect("decision");
    let options = step["actions"].as_array().expect("actions").len();
    assert!(stepper.advance(Some(options)).is_err());
    // Still the same decision.
    let again = stepper.advance(None).expect("same decision");
    assert_eq!(again["ply"], step["ply"]);
    assert_eq!(again["actions"], step["actions"]);
    assert_eq!(again["log"], serde_json::json!([]));
}

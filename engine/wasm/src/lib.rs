//! engine-wasm: deckgym-core compiled to WebAssembly for the PWA (T-015, point 3). It plays games of the owner
//! against a bot in the browser, in a Web Worker, while the game's screen is open. It never plays simulation chunks:
//! the same seed does not give the same game as engine-cli on a PC (R-003), so the queue's results would not repeat.
//!
//! The game (`live`: the seat, the numbering, the coach and the messages of `engine-cli play`), the bots (`f<N>`,
//! H-018), the coach (Fase 20) and the seeds are engine-cli's own files, compiled here unchanged; deckgym-core is not
//! modified. `stepper` is plain Rust (tested natively in tests/, against engine-cli's golden games too); this file
//! only exposes it to JavaScript through wasm-bindgen, with JSON in and out.

#[allow(dead_code)]
#[path = "../../src/coach.rs"]
mod coach;
#[allow(dead_code)]
#[path = "../../src/fair_bot.rs"]
mod fair_bot;
#[allow(dead_code)]
#[path = "../../src/g_bot.rs"]
mod g_bot;
#[allow(dead_code)]
#[path = "../../src/live.rs"]
mod live;
#[allow(dead_code)]
#[path = "../../src/seeds.rs"]
mod seeds;
pub mod stepper;

use wasm_bindgen::prelude::*;

pub use stepper::{PlayJob, Stepper};

/// The pinned deckgym revision (build.rs checks it is engine-cli's).
pub const ENGINE_REV: &str = env!("DECKGYM_REV");
/// This crate's version: bumped when the browser's games change for the same seed and choices.
pub const WASM_VERSION: &str = env!("CARGO_PKG_VERSION");

/// coach.rs asks for it at the crate root, as in engine-cli.
use seeds::game_seed;

/// How its games play: engine-cli's `GAMES_REV` (the same bots, coach and rules; not a PC's games, R-003). A game
/// started with one revision ends as `engine_changed` on a page with another.
pub const GAMES_REV: u32 = seeds::GAMES_REV;

/// `{"engineRev","gamesRev","version"}`: what the page checks before taking a game.
#[wasm_bindgen(js_name = engineInfo)]
pub fn engine_info() -> String {
    serde_json::json!({ "engineRev": ENGINE_REV, "gamesRev": GAMES_REV, "version": WASM_VERSION }).to_string()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    /// Set by the Web Worker: a panic aborts the module (wasm32 cannot unwind), so its message goes out first.
    #[wasm_bindgen(js_namespace = globalThis, js_name = __tcgEnginePanic)]
    fn report_panic(message: &str);
}

fn install_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            std::panic::set_hook(Box::new(|info| report_panic(&info.to_string())));
        });
    }
}

fn js_error(message: String) -> JsError {
    JsError::new(&message)
}

/// One game, for JavaScript: the same calls as `Stepper`, with JSON text in and out.
#[wasm_bindgen]
pub struct LiveGame {
    inner: Stepper,
}

#[wasm_bindgen]
impl LiveGame {
    /// `job`: `{"deckHuman","deckBot","bot","seed","coach"}`.
    #[wasm_bindgen(constructor)]
    pub fn new(job: &str) -> Result<LiveGame, JsError> {
        install_panic_hook();
        let job: PlayJob = serde_json::from_str(job).map_err(|e| js_error(format!("JSON inválido: {e}")))?;
        Ok(LiveGame { inner: Stepper::new(job).map_err(js_error)? })
    }

    pub fn info(&self) -> String {
        self.inner.info().to_string()
    }

    /// Plays on to the owner's next decision or the end; `choice` answers the last decision.
    pub fn advance(&mut self, choice: Option<u32>) -> Result<String, JsError> {
        Ok(self.inner.advance(choice.map(|i| i as usize)).map_err(js_error)?.to_string())
    }

    /// Modo entrenador: the values of the options of the pending decision.
    pub fn coach(&mut self) -> Result<String, JsError> {
        Ok(self.inner.coach().map_err(js_error)?.to_string())
    }

    /// The values `coach` gave this decision before a rebuild.
    #[wasm_bindgen(js_name = restoreCoach)]
    pub fn restore_coach(&mut self, values: Vec<f64>) -> Result<(), JsError> {
        self.inner.restore_coach(values).map_err(js_error)
    }

    /// The finished game's replay (deckgym's JSON format); `undefined` before the end.
    pub fn replay(&self) -> Option<String> {
        self.inner.replay()
    }
}

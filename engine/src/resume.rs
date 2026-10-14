//! Resuming a pairing from game N (H-054, feature `resume`): the S25 lost hours of games when its engine was cut near
//! the end of a 1000-game chunk. With a checkpoint, every finished game is one line of a file next to the job, and a
//! run of the same job plays only the games the file does not have. Each game depends only on its index (game `i`
//! plays with `game_seed(seed, i)`), so the result is the one of a run in one go, but for `durationMs`.
//!
//! The file: a first line that names the job (engine build, seed, games, players, decks, `perGame`) and then one line
//! per game, in the order they finish: `<index> <game> <ms>`, where `<game>` is what the caller wrote of it and `<ms>`
//! the time played so far, counting the runs before. A file of another job is started again; a line cut by the end
//! of the process (the last one, without its line break) is dropped and its game played again.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

/// FNV-1a, 64 bits: a short, stable key of a text (the decks of the job, in its header).
pub fn fnv(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

pub struct Checkpoint {
    /// None after a write that failed: nothing more goes to the file (review of #104).
    file: Mutex<Option<Box<dyn Write + Send>>>,
    /// Time played by the runs before (the most a line of the file says).
    base_ms: u128,
}

/// What a checkpoint already has: each game it played (by index), as the caller wrote it.
pub type Played = HashMap<u32, String>;

impl Checkpoint {
    /// Opens the checkpoint at `path` for the job `header` (a single line) of `games` games: the games it already has
    /// (those `valid` accepts), and a file ready to add the rest. A file of another job, or none, starts again.
    pub fn open(path: &Path, header: &str, games: u32, valid: impl Fn(&str) -> bool) -> Result<(Checkpoint, Played), String> {
        let text = match std::fs::read(path) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(format!("no se pudo leer el avance {}: {error}", path.display())),
        };
        let mut played = Played::new();
        let mut base_ms = 0u128;
        // How much of the file stays: up to the end of its last good line (0: it starts again).
        let mut keep = 0usize;
        let first = format!("{header}\n");
        if text.starts_with(&first) {
            keep = first.len();
            let mut at = keep;
            while let Some(end) = text[at..].find('\n') {
                let line = &text[at..at + end];
                let Some((index, game, ms)) = parse(line, games) else { break };
                if !valid(game) {
                    break;
                }
                played.entry(index).or_insert_with(|| game.to_string());
                base_ms = base_ms.max(ms);
                at += end + 1;
                keep = at;
            }
        }
        let open = |truncate: bool| {
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(truncate)
                .open(path)
                .map_err(|error| format!("no se pudo escribir el avance {}: {error}", path.display()))
        };
        let mut file = if keep == 0 {
            let mut file = open(true)?;
            file.write_all(first.as_bytes()).map_err(|error| format!("no se pudo escribir el avance: {error}"))?;
            played.clear();
            base_ms = 0;
            file
        } else {
            let file = open(false)?;
            // A line cut by the end of the process goes: the next one starts at a line break.
            file.set_len(keep as u64).map_err(|error| format!("no se pudo recortar el avance: {error}"))?;
            file
        };
        use std::io::Seek;
        file.seek(std::io::SeekFrom::End(0)).map_err(|error| format!("no se pudo abrir el avance: {error}"))?;
        Ok((Checkpoint { file: Mutex::new(Some(Box::new(file))), base_ms }, played))
    }

    /// The time the runs before played.
    pub fn base_ms(&self) -> u128 {
        self.base_ms
    }

    /// One finished game, in one write. A checkpoint that cannot be written does not stop the games: at worst they are
    /// played again. After the first write that fails nothing more is written: the next line would follow a cut one
    /// and could read as another, wrong game (a disk full, then free again; review of #104). The cut one is dropped
    /// when the checkpoint is opened again.
    pub fn record(&self, index: u32, game: &str, elapsed_ms: u128) {
        let line = format!("{index} {game} {}\n", self.base_ms + elapsed_ms);
        if let Ok(mut file) = self.file.lock() {
            if let Some(writer) = file.as_mut() {
                if writer.write_all(line.as_bytes()).is_err() {
                    *file = None;
                }
            }
        }
    }
}

/// `<index> <game…> <ms>`: the index (below `games`), what the game was and the time played so far.
fn parse(line: &str, games: u32) -> Option<(u32, &str, u128)> {
    let (index, rest) = line.split_once(' ')?;
    let (game, ms) = rest.rsplit_once(' ')?;
    let index: u32 = index.parse().ok()?;
    let ms: u128 = ms.parse().ok()?;
    (index < games && !game.is_empty()).then_some((index, game, ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("engine-cli-resume-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn keeps_the_games_of_its_job_and_drops_a_cut_line() {
        let dir = dir("keep");
        let path = dir.join("progress.txt");
        {
            let (checkpoint, played) = Checkpoint::open(&path, "# job 1", 10, |_| true).unwrap();
            assert!(played.is_empty());
            checkpoint.record(3, "A0P 14 21", 900);
            checkpoint.record(0, "B1N 9 10", 1200);
        }
        // The end of the process cut its last line.
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"7 A0").unwrap();
        drop(file);
        let (checkpoint, played) = Checkpoint::open(&path, "# job 1", 10, |_| true).unwrap();
        assert_eq!(played.len(), 2);
        assert_eq!(played[&3], "A0P 14 21");
        assert_eq!(played[&0], "B1N 9 10");
        assert_eq!(checkpoint.base_ms(), 1200);
        checkpoint.record(7, "T0L 31 22", 50);
        drop(checkpoint);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "# job 1\n3 A0P 14 21 900\n0 B1N 9 10 1200\n7 T0L 31 22 1250\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn another_job_or_a_bad_line_starts_again_from_there() {
        let dir = dir("other");
        let path = dir.join("progress.txt");
        std::fs::write(&path, "# job 1\n3 A0P 14 21 900\n").unwrap();
        let (_, played) = Checkpoint::open(&path, "# job 2", 10, |_| true).unwrap();
        assert!(played.is_empty());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# job 2\n");
        // An index past the games, or a game the caller cannot read: the rest of the file goes.
        std::fs::write(&path, "# job 2\n1 A0P 14 21 10\n12 A0P 14 21 20\n2 A0P 14 21 30\n").unwrap();
        let (_, played) = Checkpoint::open(&path, "# job 2", 10, |_| true).unwrap();
        assert_eq!(played.keys().copied().collect::<Vec<_>>(), vec![1]);
        std::fs::write(&path, "# job 2\n1 A0P 14 21 10\n2 ??? 30\n").unwrap();
        let (_, played) = Checkpoint::open(&path, "# job 2", 10, |game| !game.contains('?')).unwrap();
        assert_eq!(played.len(), 1);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# job 2\n1 A0P 14 21 10\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A disk with `room` bytes, that has room again after the write it refused.
    struct Filling {
        written: std::sync::Arc<Mutex<Vec<u8>>>,
        room: usize,
        refused: bool,
    }

    impl Write for Filling {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let mut written = self.written.lock().unwrap();
            let take = if self.refused { bytes.len() } else { bytes.len().min(self.room.saturating_sub(written.len())) };
            if take == 0 {
                self.refused = true;
                return Err(std::io::Error::other("disco lleno"));
            }
            written.extend_from_slice(&bytes[..take]);
            Ok(take)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn after_a_write_that_fails_nothing_more_goes_to_the_checkpoint() {
        let written = std::sync::Arc::new(Mutex::new(Vec::new()));
        let filling = Filling { written: written.clone(), room: 18, refused: false };
        let checkpoint = Checkpoint { file: Mutex::new(Some(Box::new(filling))), base_ms: 0 };
        checkpoint.record(1, "A0P 14 21", 5);
        // The disk fills up in the middle of the line: it is left cut, without its line break.
        checkpoint.record(2, "B1N 9 10", 6);
        // The disk has room again. A line here would follow the cut one and read as game 2, «B13 T0L 31 22».
        checkpoint.record(3, "T0L 31 22", 7);
        let text = String::from_utf8(written.lock().unwrap().clone()).unwrap();
        assert_eq!(text, "1 A0P 14 21 5\n2 B1");
    }
}

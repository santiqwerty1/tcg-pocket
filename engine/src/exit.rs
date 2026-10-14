//! How engine-cli ends, said on stderr as its last line. The S25 of 12–13/10/2026 ended with 0 and no `result.json`
//! halfway through a chunk, and nothing said why (H-054). Now the last line is one of:
//! - `fin ok`: it did what it was asked (and wrote its result, if it had one to write);
//! - `fin error <code>`: it ended with that exit code (2 bad input, 3 the engine failed, 4 nobody answers a live game);
//! - `fin pánico`: a panic outside a game (inside one it is caught and reported), with exit code 101 as before;
//! - `fin señal <n>`: on Unix, SIGTERM, SIGINT, SIGHUP, SIGQUIT, SIGUSR1, SIGUSR2, SIGXCPU, SIGXFSZ, SIGALRM or (Linux and
//!   Android) SIGPWR; then it dies of that signal as before, so whoever waits for it still sees the signal. The faults
//!   (SEGV, BUS, ILL, FPE, ABRT, TRAP, SYS) are left alone: Rust's runtime uses SEGV and BUS for stack overflows, and a
//!   fault is seen as its signal anyway. A signal ignored on start (`nohup`) stays ignored;
//! - `fin exit sin terminar`: on Unix, through `atexit`, something called `exit` before the end.
//!
//! With exit code 0 and none of them, the line was lost on the way or the process ended through `_exit` (which skips
//! `atexit`), or the engine is older than 0.3.7. A SIGKILL is seen as the signal, not as code 0.
//!
//! Every line goes in one `write` (the worker reads stderr in pieces: a line written in parts could be cut, review of
//! the diagnosis), and the handler's starts with a line break, in case it lands in the middle of another line.

use std::sync::atomic::{AtomicU8, Ordering};

const RUNNING: u8 = 0;
/// A signal handler is writing its line and ending the process: nothing else writes one.
#[cfg(unix)]
const SIGNALED: u8 = 1;
const FINISHED: u8 = 2;
static STATE: AtomicU8 = AtomicU8::new(RUNNING);

/// One whole line on stderr, in one write (with its line break). A closed stderr is not an error here.
pub fn line(text: &str) {
    // In the unit tests, through the macro the test harness captures (a direct write would fill their output).
    #[cfg(test)]
    {
        eprintln!("{text}");
    }
    #[cfg(not(test))]
    write_line(text);
}

#[cfg(not(test))]
fn write_line(text: &str) {
    use std::io::Write;
    let mut bytes = Vec::with_capacity(text.len() + 1);
    bytes.extend_from_slice(text.as_bytes());
    bytes.push(b'\n');
    let mut stderr = std::io::stderr().lock();
    let _ = stderr.write_all(&bytes);
    let _ = stderr.flush();
}

/// The last line, once; not after a signal handler took over.
pub fn finish(how: &str) {
    if STATE.compare_exchange(RUNNING, FINISHED, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        line(&format!("fin {how}"));
    }
}

/// The handler's line: `\nfin señal <n>\n`, built without allocating (a signal handler can only write).
#[cfg(any(unix, test))]
fn signal_line(signal: u32, buffer: &mut [u8; 32]) -> usize {
    let prefix = "\nfin señal ".as_bytes();
    buffer[..prefix.len()].copy_from_slice(prefix);
    let mut length = prefix.len();
    let mut digits = [0u8; 10];
    let mut count = 0;
    let mut rest = signal;
    loop {
        digits[count] = b'0' + (rest % 10) as u8;
        count += 1;
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    while count > 0 {
        count -= 1;
        buffer[length] = digits[count];
        length += 1;
    }
    buffer[length] = b'\n';
    length + 1
}

#[cfg(unix)]
extern "C" fn on_exit() {
    if STATE.load(Ordering::SeqCst) == RUNNING {
        let text = b"\nfin exit sin terminar\n";
        unsafe {
            libc::write(2, text.as_ptr().cast(), text.len());
        }
    }
}

#[cfg(unix)]
extern "C" fn on_signal(signal: libc::c_int) {
    match STATE.compare_exchange(RUNNING, SIGNALED, Ordering::SeqCst, Ordering::SeqCst) {
        Ok(_) => {
            let mut buffer = [0u8; 32];
            let length = signal_line(signal as u32, &mut buffer);
            unsafe {
                libc::write(2, buffer.as_ptr().cast(), length);
            }
        }
        // Another handler is already saying its line and ending the process: let it (two signals at once).
        Err(SIGNALED) => return,
        // After its last line: it only dies of the signal.
        Err(_) => {}
    }
    // Then it ends as it would have without the handler: killed by that signal.
    unsafe {
        libc::signal(signal, libc::SIG_DFL);
        libc::raise(signal);
    }
}

/// The signals that end a process, can be caught and are not faults.
#[cfg(unix)]
fn ending_signals() -> Vec<libc::c_int> {
    let mut signals = vec![
        libc::SIGTERM,
        libc::SIGINT,
        libc::SIGHUP,
        libc::SIGQUIT,
        libc::SIGUSR1,
        libc::SIGUSR2,
        libc::SIGXCPU,
        libc::SIGXFSZ,
        libc::SIGALRM,
    ];
    #[cfg(any(target_os = "linux", target_os = "android"))]
    signals.push(libc::SIGPWR);
    signals
}

/// At the start of `main`. On Windows there is nothing to install: `fin ok`, `fin error` and `fin pánico` still go.
pub fn install() {
    #[cfg(unix)]
    unsafe {
        libc::atexit(on_exit);
        let handler: extern "C" fn(libc::c_int) = on_signal;
        for signal in ending_signals() {
            let mut old: libc::sigaction = std::mem::zeroed();
            if libc::sigaction(signal, std::ptr::null(), &mut old) != 0 || old.sa_sigaction == libc::SIG_IGN {
                // Ignored by whoever started it (`nohup`, `trap "" HUP`): it stays ignored.
                continue;
            }
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = handler as *const () as libc::sighandler_t;
            action.sa_flags = libc::SA_RESTART;
            libc::sigemptyset(&mut action.sa_mask);
            libc::sigaction(signal, &action, std::ptr::null_mut());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_signal_line_says_its_number_on_a_line_of_its_own() {
        let mut buffer = [0u8; 32];
        for (signal, text) in [(15, "\nfin señal 15\n"), (1, "\nfin señal 1\n"), (30, "\nfin señal 30\n"), (0, "\nfin señal 0\n")]
        {
            let length = signal_line(signal, &mut buffer);
            assert_eq!(std::str::from_utf8(&buffer[..length]).unwrap(), text);
        }
    }

    /// Run only by the next test, in a process of its own: it ends the process with `exit` before the end.
    #[cfg(unix)]
    #[test]
    #[ignore = "it ends its process: the next test runs it"]
    fn exits_before_the_end() {
        install();
        std::process::exit(3);
    }

    #[cfg(unix)]
    #[test]
    fn an_exit_before_the_end_says_so() {
        let out = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .args(["--exact", "exit::tests::exits_before_the_end", "--ignored", "--nocapture", "--test-threads=1"])
            .output()
            .expect("test binary");
        assert_eq!(out.status.code(), Some(3));
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(stderr.lines().last(), Some("fin exit sin terminar"), "{stderr}");
    }
}

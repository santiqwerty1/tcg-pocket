//! How engine-cli ends, said on stderr as its last line. The S25 of 12–13/10/2026 ended with 0 and no `result.json`
//! halfway through a chunk, and nothing said why (H-054). Now the last line is one of:
//! - `fin ok`: it did what it was asked (and wrote its result, if it had one to write);
//! - `fin error <code>`: it ended with that exit code (2 bad input, 3 the engine failed, 4 nobody answers a live game);
//! - `fin pánico`: a panic outside a game (inside one it is caught and reported), with exit code 101 as before;
//! - `fin señal <n>`: it got a signal it can catch (on Unix: SIGTERM, SIGHUP, SIGINT…), and then dies of it as before;
//! - `fin exit sin terminar`: something called `exit` before the end (on Unix, through `atexit`).
//!
//! A process that ends with none of them was stopped without a chance to say it: SIGKILL, or frozen and never woken.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

/// Set before the last line: an `exit` after it is the normal end, not a cut.
static FINISHED: AtomicBool = AtomicBool::new(false);

/// The last line on stderr, once. A closed stderr is not an error here.
pub fn finish(how: &str) {
    if FINISHED.swap(true, Ordering::SeqCst) {
        return;
    }
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "fin {how}");
    let _ = stderr.flush();
}

/// The line for a signal: `fin señal <n>\n`, built without allocating (a signal handler can only write).
fn signal_line(signal: u32, buffer: &mut [u8; 32]) -> usize {
    let prefix = "fin señal ".as_bytes();
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
    if !FINISHED.load(Ordering::SeqCst) {
        let line = b"fin exit sin terminar\n";
        unsafe {
            libc::write(2, line.as_ptr().cast(), line.len());
        }
    }
}

#[cfg(unix)]
extern "C" fn on_signal(signal: libc::c_int) {
    if !FINISHED.swap(true, Ordering::SeqCst) {
        let mut buffer = [0u8; 32];
        let length = signal_line(signal as u32, &mut buffer);
        unsafe {
            libc::write(2, buffer.as_ptr().cast(), length);
        }
    }
    // Then it ends as it would have without the handler: killed by that signal (the worker sees the signal).
    unsafe {
        libc::signal(signal, libc::SIG_DFL);
        libc::raise(signal);
    }
}

/// The signals that end a process and can be caught. SIGKILL and SIGSTOP cannot.
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

/// At the start of `main`. On Windows there is nothing to install: `fin ok` and `fin error` still go.
pub fn install() {
    #[cfg(unix)]
    unsafe {
        libc::atexit(on_exit);
        for signal in ending_signals() {
            libc::signal(signal, on_signal as libc::sighandler_t);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_signal_line_says_its_number() {
        let mut buffer = [0u8; 32];
        for (signal, line) in [(15, "fin señal 15\n"), (1, "fin señal 1\n"), (30, "fin señal 30\n"), (0, "fin señal 0\n")] {
            let length = signal_line(signal, &mut buffer);
            assert_eq!(std::str::from_utf8(&buffer[..length]).unwrap(), line);
        }
    }
}

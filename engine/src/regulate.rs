//! The CPU regulator (Windows, feature `regulate`, pedido de Santi del 14/10/2026): the worker's engines use every
//! logical processor while nothing else needs them, and give whole cores back as soon as another program does.
//!
//! `engine-cli regulate [--max N] [--floor N] [--every-ms N] [--trace]` runs next to the worker, which tells it on stdin
//! the engines it starts and the ones that end:
//! - `add <pid> managed`: a simulation engine (simulate, batch, consistency, optimize): it is regulated;
//! - `add <pid> own`: a live game against the bot (normal priority): never narrowed, but its CPU is ours, not foreign;
//! - `remove <pid>`.
//!
//! Every second it measures the others' load: the machine's busy time less the time of every engine it knows
//! (`GetProcessTimes`), in logical processors. The machine's busy time is the hypervisor's when Windows runs on
//! Hyper-V, as with WSL 2 (`\Hyper-V Hypervisor Logical Processor(_Total)\% Total Run Time`, through PDH by its English
//! name): Windows and its virtual machines together, where a VM's CPU may not show in Windows' own counters. Without
//! Hyper-V, Windows' own (`GetSystemTimes`). The engines get the rest, between `--floor` and
//! `--max`: down at once when the others need more, up one core at a time when they keep needing less (hysteresis).
//! The mask goes by whole cores (both hyper-threads together), the efficient ones first and then the performance ones
//! from the last, so the others keep the first performance cores to themselves; `SetProcessAffinityMask` changes it on
//! the engines that are running, which go on with their games (each game depends only on its index: no result
//! changes).
//!
//! Each change of the allowed processors is a line on stdout: `permitido <n> de <total> ajena <load> mascara <hex>`
//! (with `--trace`, every sample too: `muestra ajena <load> permitido <n>`). An engine it cannot open or change, or a
//! PID that is not running this same program (so never another program's process), is a line `aviso …`.
//! When stdin ends (the worker stops or dies), every engine gets its whole mask back and the regulator ends.

/// One physical core: the mask of its logical processors (two with hyper-threading) and its efficiency class (higher
/// is faster: on an i7-12700 the E-cores are 0 and the P-cores 1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Core {
    pub mask: u64,
    pub class: u8,
}

impl Core {
    fn logical(self) -> u32 {
        self.mask.count_ones()
    }
}

/// The order the engines take cores in: the efficient class first, and within a class from the last core, so the
/// others keep the first performance cores (where Windows puts their work first) to themselves.
pub fn core_order(cores: &[Core]) -> Vec<Core> {
    let mut indexed: Vec<(usize, Core)> = cores.iter().copied().enumerate().collect();
    indexed.sort_by(|(a, x), (b, y)| x.class.cmp(&y.class).then(b.cmp(a)));
    indexed.into_iter().map(|(_, core)| core).collect()
}

/// The mask of whole cores, in `order`, with at most `allowed` logical processors (at least one core).
pub fn mask_for(order: &[Core], allowed: u32) -> u64 {
    let mut mask = 0u64;
    let mut count = 0u32;
    for core in order {
        if count > 0 && count + core.logical() > allowed {
            continue;
        }
        mask |= core.mask;
        count += core.logical();
        if count >= allowed {
            break;
        }
    }
    mask
}

/// How many logical processors the engines get, from the others' load, one sample at a time.
pub struct Policy {
    total: u32,
    floor: u32,
    max: u32,
    /// What the engines have now.
    pub allowed: u32,
    /// Samples in a row with room for more (it grows only after `grow_after` of them).
    room: u32,
    grow_after: u32,
}

impl Policy {
    pub fn new(total: u32, floor: u32, max: u32, grow_after: u32) -> Self {
        let max = max.clamp(1, total);
        let floor = floor.clamp(1, max);
        Policy { total, floor, max, allowed: max, room: 0, grow_after }
    }

    /// The others' load (busy logical processors, beyond our engines) of the last sample: what the engines get now.
    /// Less than one busy processor is the system's own noise and leaves nothing aside; from one, the others get their
    /// load rounded up. Down at once; up by `step` processors after `grow_after` samples in a row with room for it.
    pub fn next(&mut self, foreign: f64, step: u32) -> u32 {
        let reserve = if foreign < 1.0 { 0.0 } else { foreign.ceil() };
        let target = ((f64::from(self.total) - reserve).max(0.0) as u32).clamp(self.floor, self.max);
        if target < self.allowed {
            self.allowed = target;
            self.room = 0;
        } else if target >= self.allowed + step.max(1) || (target > self.allowed && target == self.max) {
            self.room += 1;
            if self.room >= self.grow_after {
                self.allowed = (self.allowed + step.max(1)).min(target);
                self.room = 0;
            }
        } else {
            self.room = 0;
        }
        self.allowed
    }
}

/// What the worker says on stdin.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    /// An engine to regulate (`managed`) or only to count as ours (`own`).
    Add { pid: u32, managed: bool },
    Remove { pid: u32 },
}

/// A line of the worker; None for anything else (ignored).
pub fn parse_command(line: &str) -> Option<Command> {
    let mut parts = line.split_whitespace();
    let (verb, pid) = (parts.next()?, parts.next()?.parse().ok()?);
    let command = match (verb, parts.next()) {
        ("add", Some("managed")) => Command::Add { pid, managed: true },
        ("add", Some("own")) => Command::Add { pid, managed: false },
        ("remove", None) => Command::Remove { pid },
        _ => return None,
    };
    parts.next().is_none().then_some(command)
}

/// What `engine-cli regulate` was asked: the most and the least logical processors, and how often to look.
#[derive(Debug, PartialEq)]
pub struct Options {
    pub max: Option<u32>,
    pub floor: u32,
    pub every_ms: u64,
    /// Every sample on stdout (`muestra ajena <load> permitido <n>`), to see why it allows what it does.
    pub trace: bool,
}

pub fn parse_options(args: &[String]) -> Result<Options, String> {
    let mut options = Options { max: None, floor: 2, every_ms: 1000, trace: false };
    let mut at = 0;
    while at < args.len() {
        if args[at] == "--trace" {
            options.trace = true;
            at += 1;
            continue;
        }
        let value = args.get(at + 1).ok_or_else(|| format!("falta el valor de {}", args[at]))?;
        let number: u64 = value.parse().map_err(|_| format!("{} no es un número: {value}", args[at]))?;
        match args[at].as_str() {
            "--max" => options.max = Some(number.clamp(1, 1024) as u32),
            "--floor" => options.floor = number.clamp(1, 1024) as u32,
            "--every-ms" => options.every_ms = number.clamp(100, 60_000),
            other => return Err(format!("opción desconocida: {other}")),
        }
        at += 2;
    }
    Ok(options)
}

/// Our engines' CPU time (100 ns) between two samples, by PID: what is not the others' load.
#[derive(Default)]
pub struct Accounts {
    /// Each engine's time at the last sample (0 for one told since then).
    last: std::collections::HashMap<u32, u64>,
    /// The time of the engines removed since the last sample.
    gone: u64,
}

impl Accounts {
    /// An engine told. Its whole time counts as ours at the next sample: what it played before that sample's start can
    /// only make the others' load look smaller once, never narrow the engines (an engine told late, after the
    /// regulator started again).
    pub fn add(&mut self, pid: u32) {
        self.last.insert(pid, 0);
    }

    /// An engine gone, with its time now if it can still be read: its time since the last sample is still ours, or an
    /// engine that ends reads as the others' load and narrows the next one (autorrevisión).
    pub fn remove(&mut self, pid: u32, now: Option<u64>) {
        if let (Some(last), Some(now)) = (self.last.remove(&pid), now) {
            self.gone += now.saturating_sub(last);
        }
    }

    pub fn has(&self, pid: u32) -> bool {
        self.last.contains_key(&pid)
    }

    /// The sample: our time since the last one. `read` gives each engine's time and whether it ended; one that ended
    /// is counted and goes, and one that cannot be read goes.
    pub fn sample(&mut self, mut read: impl FnMut(u32) -> Option<(u64, bool)>) -> u64 {
        let mut ours = std::mem::take(&mut self.gone);
        self.last.retain(|pid, last| match read(*pid) {
            Some((time, ended)) => {
                ours += time.saturating_sub(*last);
                *last = time;
                !ended
            }
            None => false,
        });
        ours
    }
}

/// One processor the engines can grow by: a P-core with its two threads (2 logical processors).
const STEP: u32 = 2;
/// Samples in a row with room before it grows a step (with a sample a second, about 5 s).
const GROW_AFTER: u32 = 5;

#[cfg(windows)]
mod win {
    use super::*;
    use std::collections::HashMap;
    use std::io::{BufRead, Write};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows_sys::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterValue, PdhOpenQueryW,
        PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
    };
    use windows_sys::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, RelationProcessorCore, SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetProcessAffinityMask, GetProcessTimes, GetSystemTimes, OpenProcess,
        QueryFullProcessImageNameW, SetProcessAffinityMask, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SET_INFORMATION,
    };

    fn ticks(time: &FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }

    /// The machine's physical cores, as Windows lists them (processor group 0 only).
    pub fn cores() -> Result<Vec<Core>, String> {
        let mut length = 0u32;
        unsafe { GetLogicalProcessorInformationEx(RelationProcessorCore, std::ptr::null_mut(), &mut length) };
        // u64s: the records are 8-byte aligned.
        let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
        let ok = unsafe { GetLogicalProcessorInformationEx(RelationProcessorCore, buffer.as_mut_ptr().cast(), &mut length) };
        if ok == 0 {
            return Err("no pude leer los núcleos de la máquina".to_string());
        }
        let bytes = buffer.as_ptr().cast::<u8>();
        let mut cores = Vec::new();
        let mut at = 0usize;
        while at + 8 <= length as usize {
            // Copied out: a record can be shorter than the whole union.
            let mut info = SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX::default();
            let size = unsafe { std::ptr::read_unaligned(bytes.add(at + 4).cast::<u32>()) } as usize;
            let copy = size.min(std::mem::size_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>()).min(length as usize - at);
            unsafe { std::ptr::copy_nonoverlapping(bytes.add(at), (&mut info as *mut SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX).cast(), copy) };
            if size == 0 {
                break;
            }
            if info.Relationship == RelationProcessorCore {
                let core = unsafe { info.Anonymous.Processor };
                if core.GroupCount != 1 || core.GroupMask[0].Group != 0 {
                    return Err("la máquina tiene más de un grupo de procesadores (más de 64 lógicos)".to_string());
                }
                cores.push(Core { mask: core.GroupMask[0].Mask as u64, class: core.EfficiencyClass });
            }
            at += size;
        }
        if cores.is_empty() {
            return Err("no encontré núcleos".to_string());
        }
        Ok(cores)
    }

    /// The whole system's busy and total time (100 ns, summed over every logical processor).
    fn system_times() -> Option<(u64, u64)> {
        let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
            return None;
        }
        // The kernel time counts the idle time too.
        let total = ticks(&kernel) + ticks(&user);
        Some((total.saturating_sub(ticks(&idle)), total))
    }

    /// The hypervisor's logical processors' run time (Hyper-V): the machine's real CPU, VMs included.
    struct Hypervisor {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }

    impl Hypervisor {
        fn open() -> Option<Hypervisor> {
            let path: Vec<u16> =
                "\\Hyper-V Hypervisor Logical Processor(_Total)\\% Total Run Time\0".encode_utf16().collect();
            let mut query: PDH_HQUERY = std::ptr::null_mut();
            if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
                return None;
            }
            let mut counter: PDH_HCOUNTER = std::ptr::null_mut();
            let hypervisor = Hypervisor { query, counter: std::ptr::null_mut() };
            if unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) } != 0 {
                return None;
            }
            let hypervisor = Hypervisor { counter, ..hypervisor };
            // The first collection only starts the interval.
            (unsafe { PdhCollectQueryData(query) } == 0).then_some(hypervisor)
        }

        /// The share (0 to 1) of every logical processor's time that ran something, since the last call.
        fn busy(&self) -> Option<f64> {
            if unsafe { PdhCollectQueryData(self.query) } != 0 {
                return None;
            }
            let mut value = PDH_FMT_COUNTERVALUE::default();
            let status =
                unsafe { PdhGetFormattedCounterValue(self.counter, PDH_FMT_DOUBLE, std::ptr::null_mut(), &mut value) };
            (status == 0).then(|| (unsafe { value.Anonymous.doubleValue } / 100.0).clamp(0.0, 1.0))
        }
    }

    impl Drop for Hypervisor {
        fn drop(&mut self) {
            unsafe { PdhCloseQuery(self.query) };
        }
    }

    struct Engine {
        handle: HANDLE,
        managed: bool,
        /// A mask it refused was said once (`aviso`), not at every change.
        warned: bool,
    }

    /// The program a process runs, in lower case (None if it cannot be read).
    fn image(handle: HANDLE) -> Option<String> {
        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length) } == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..length as usize]).to_lowercase())
    }

    /// Changes an engine's mask; a refusal is said once per engine.
    fn narrow(pid: u32, engine: &mut Engine, mask: u64) {
        if unsafe { SetProcessAffinityMask(engine.handle, mask as usize) } == 0 && !engine.warned {
            engine.warned = true;
            say(&format!("aviso no pude cambiar los procesadores del motor {pid}"));
        }
    }

    /// An engine's CPU time and whether it ended.
    fn process_time(handle: HANDLE) -> Option<(u64, bool)> {
        let (mut creation, mut exit, mut kernel, mut user) =
            (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0 {
            return None;
        }
        Some((ticks(&kernel) + ticks(&user), ticks(&exit) != 0))
    }

    fn say(line: &str) {
        let mut out = std::io::stdout().lock();
        let _ = out.write_all(format!("{line}\n").as_bytes());
        let _ = out.flush();
    }

    pub fn run(options: Options) -> Result<(), String> {
        let cores = cores()?;
        let order = core_order(&cores);
        let total: u32 = cores.iter().map(|core| core.mask.count_ones()).sum();
        let (mut process_mask, mut system_mask) = (0usize, 0usize);
        unsafe { GetProcessAffinityMask(GetCurrentProcess(), &mut process_mask, &mut system_mask) };
        let full = if system_mask == 0 { cores.iter().fold(0u64, |mask, core| mask | core.mask) } else { system_mask as u64 };
        let max = options.max.unwrap_or(total).min(total);
        let mut policy = Policy::new(total, options.floor, max, GROW_AFTER);
        let efficient = cores.iter().filter(|core| core.class < cores.iter().map(|c| c.class).max().unwrap_or(0)).count();
        let hypervisor = Hypervisor::open();
        say(&format!(
            "regulador {total} logicos {} nucleos ({efficient} eficientes) maximo {max} piso {} medida {}",
            cores.len(),
            options.floor.min(max),
            if hypervisor.is_some() { "hipervisor" } else { "sistema" }
        ));
        // The worker's lines, on a thread of their own: its end (stdin closed) ends the regulator.
        let (sender, commands) = mpsc::channel::<Option<Command>>();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                if let Some(command) = parse_command(&line) {
                    if sender.send(Some(command)).is_err() {
                        return;
                    }
                }
            }
            let _ = sender.send(None);
        });
        // The engines it is told of run this same program (the worker starts it from its engine).
        let own_image = {
            let me = unsafe { GetCurrentProcess() };
            image(me).ok_or_else(|| "no pude leer el programa del regulador".to_string())?
        };
        let mut engines: HashMap<u32, Engine> = HashMap::new();
        let mut accounts = Accounts::default();
        let mut mask = mask_for(&order, policy.allowed) & full;
        let mut last_system = system_times();
        let mut last_at = Instant::now();
        let every = Duration::from_millis(options.every_ms);
        loop {
            let deadline = Instant::now() + every;
            // The worker's lines until the next sample.
            loop {
                let wait = deadline.saturating_duration_since(Instant::now());
                match commands.recv_timeout(wait) {
                    Ok(Some(Command::Add { pid, managed })) => {
                        let access = PROCESS_QUERY_LIMITED_INFORMATION | if managed { PROCESS_SET_INFORMATION } else { 0 };
                        let handle = unsafe { OpenProcess(access, 0, pid) };
                        if handle.is_null() {
                            say(&format!("aviso no pude abrir el motor {pid}"));
                            continue;
                        }
                        // Only an engine like this one: a PID of an engine that already ended may be another
                        // program's by now (autorrevisión).
                        if image(handle).is_none_or(|program| program != own_image) {
                            say(&format!("aviso {pid} no es un motor: no lo toco"));
                            unsafe { CloseHandle(handle) };
                            continue;
                        }
                        let mut engine = Engine { handle, managed, warned: false };
                        // A new engine starts within what the engines have now.
                        if managed {
                            narrow(pid, &mut engine, mask);
                        }
                        if let Some(old) = engines.insert(pid, engine) {
                            unsafe { CloseHandle(old.handle) };
                        }
                        accounts.add(pid);
                    }
                    Ok(Some(Command::Remove { pid })) => {
                        if let Some(engine) = engines.remove(&pid) {
                            accounts.remove(pid, process_time(engine.handle).map(|(time, _)| time));
                            unsafe { CloseHandle(engine.handle) };
                        }
                    }
                    // The worker went away: every engine gets the whole machine back, and the regulator ends.
                    Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                        for engine in engines.values() {
                            if engine.managed {
                                unsafe { SetProcessAffinityMask(engine.handle, full as usize) };
                            }
                            unsafe { CloseHandle(engine.handle) };
                        }
                        say("regulador terminado");
                        return Ok(());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                }
            }
            // The sample: the whole system's busy time less our engines', in logical processors.
            let Some(system) = system_times() else { continue };
            let ours = accounts.sample(|pid| engines.get(&pid).and_then(|engine| process_time(engine.handle)));
            // The ones that ended, or cannot be read, go; one that cannot be read gets the whole machine back first
            // (on one that ended it does nothing).
            engines.retain(|pid, engine| {
                let keep = accounts.has(*pid);
                if !keep {
                    if engine.managed {
                        unsafe { SetProcessAffinityMask(engine.handle, full as usize) };
                    }
                    unsafe { CloseHandle(engine.handle) };
                }
                keep
            });
            let elapsed = last_at.elapsed();
            last_at = Instant::now();
            let Some((busy_before, total_before)) = last_system.replace(system) else { continue };
            let (busy, all) = (system.0.saturating_sub(busy_before), system.1.saturating_sub(total_before));
            if all == 0 || elapsed.is_zero() {
                continue;
            }
            // The others' load: the machine's busy processors less ours (the hypervisor's, VMs included, if there is
            // one; else Windows' own).
            let ours_logical = ours as f64 / (elapsed.as_secs_f64() * 1e7);
            let foreign = match hypervisor.as_ref().and_then(Hypervisor::busy) {
                Some(share) => (share * f64::from(total) - ours_logical).max(0.0),
                None => busy.saturating_sub(ours) as f64 / all as f64 * f64::from(total),
            };
            let before = policy.allowed;
            let allowed = policy.next(foreign, STEP);
            let next = mask_for(&order, allowed) & full;
            if next != mask {
                mask = next;
                for (pid, engine) in engines.iter_mut().filter(|(_, engine)| engine.managed) {
                    narrow(*pid, engine, mask);
                }
            }
            if options.trace {
                say(&format!("muestra ajena {foreign:.1} permitido {}", mask.count_ones()));
            }
            if allowed != before {
                say(&format!(
                    "permitido {} de {total} ajena {foreign:.1} mascara {mask:x}",
                    mask.count_ones()
                ));
            }
        }
    }
}

/// `engine-cli regulate`: only on Windows (the worker starts it there when its engine says `regulate`).
pub fn regulate(args: &[String]) -> Result<(), String> {
    let options = parse_options(args)?;
    #[cfg(windows)]
    {
        win::run(options)
    }
    #[cfg(not(windows))]
    {
        let _ = options;
        Err("el regulador de CPU es solo para Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An i7-12700: 8 P-cores with hyper-threading (logical 0–15, in pairs) and 4 E-cores (16–19), as Windows lists it.
    fn i7_12700() -> Vec<Core> {
        let mut cores: Vec<Core> = (0..8).map(|i| Core { mask: 0b11 << (2 * i), class: 1 }).collect();
        cores.extend((16..20).map(|i| Core { mask: 1 << i, class: 0 }));
        cores
    }

    #[test]
    fn the_engines_take_the_e_cores_first_and_then_the_last_p_cores_whole() {
        let order = core_order(&i7_12700());
        assert_eq!(order[..4].iter().map(|c| c.mask).collect::<Vec<_>>(), vec![1 << 19, 1 << 18, 1 << 17, 1 << 16]);
        assert_eq!(order[4].mask, 0b11 << 14, "then the last P-core, both its threads");
        // 4 logical: the E-cores only; 6: and the last P-core whole; 5: never half a P-core.
        assert_eq!(mask_for(&order, 4), 0xF_0000);
        assert_eq!(mask_for(&order, 6), 0xF_0000 | 0b11 << 14);
        assert_eq!(mask_for(&order, 5), 0xF_0000);
        assert_eq!(mask_for(&order, 20), 0xF_FFFF);
        assert_eq!(mask_for(&order, 2).count_ones(), 2);
        // At least one core, even with less than one allowed.
        assert_eq!(mask_for(&order, 0).count_ones(), 1);
        // The first P-core stays for the others the longest: 18 leave it free, 16 the first two.
        assert_eq!(mask_for(&order, 18) & 0b11, 0);
        assert_eq!(mask_for(&order, 16) & 0b1111, 0);
    }

    #[test]
    fn it_gives_way_at_once_and_comes_back_slowly() {
        let mut policy = Policy::new(20, 2, 20, 5);
        assert_eq!(policy.allowed, 20);
        // Nothing else running: all of it.
        assert_eq!(policy.next(0.3, 2), 20);
        // The others need 8: down at once, leaving them 8; a bit more, 9.
        assert_eq!(policy.next(8.0, 2), 12);
        assert_eq!(policy.next(8.2, 2), 11);
        // They keep needing it: it stays.
        for _ in 0..10 {
            assert_eq!(policy.next(8.2, 2), 11);
        }
        // They are done: up two at a time, every 5 samples.
        let mut seen = Vec::new();
        for _ in 0..30 {
            seen.push(policy.next(0.2, 2));
        }
        assert_eq!(&seen[..4], &[11, 11, 11, 11]);
        assert_eq!(seen[4], 13);
        assert_eq!(seen[9], 15);
        assert_eq!(*seen.last().unwrap(), 20);
        // A spike for one sample takes it down; a sample with room in between does not bring it back at once.
        assert_eq!(policy.next(15.0, 2), 5);
        assert_eq!(policy.next(0.0, 2), 5);
    }

    #[test]
    fn it_never_goes_under_the_floor_nor_over_the_max() {
        let mut policy = Policy::new(20, 2, 16, 1);
        assert_eq!(policy.allowed, 16);
        assert_eq!(policy.next(19.9, 2), 2);
        assert_eq!(policy.next(40.0, 2), 2);
        for _ in 0..20 {
            policy.next(0.0, 2);
        }
        assert_eq!(policy.allowed, 16);
        // A max over the machine is the machine, a floor over the max is the max.
        let policy = Policy::new(8, 12, 30, 1);
        assert_eq!(policy.allowed, 8);
        assert_eq!(Policy::new(8, 12, 6, 1).floor, 6);
    }

    #[test]
    fn it_reads_the_worker_lines_and_nothing_else() {
        assert_eq!(parse_command("add 4120 managed"), Some(Command::Add { pid: 4120, managed: true }));
        assert_eq!(parse_command("add 77 own"), Some(Command::Add { pid: 77, managed: false }));
        assert_eq!(parse_command("remove 4120"), Some(Command::Remove { pid: 4120 }));
        for bad in ["", "add", "add x managed", "add 1", "add 1 other", "remove 1 2", "add 1 managed extra", "kill 1"] {
            assert_eq!(parse_command(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn its_options_have_defaults_and_bounds() {
        assert_eq!(parse_options(&[]).unwrap(), Options { max: None, floor: 2, every_ms: 1000, trace: false });
        let args: Vec<String> =
            ["--max", "16", "--trace", "--floor", "4", "--every-ms", "50"].iter().map(|a| a.to_string()).collect();
        assert_eq!(parse_options(&args).unwrap(), Options { max: Some(16), floor: 4, every_ms: 100, trace: true });
        assert!(parse_options(&["--max".to_string()]).is_err());
        assert!(parse_options(&["--max".to_string(), "x".to_string()]).is_err());
        assert!(parse_options(&["--other".to_string(), "1".to_string()]).is_err());
    }

    #[test]
    fn an_engine_that_starts_or_ends_between_samples_is_still_ours() {
        let mut accounts = Accounts::default();
        accounts.add(1);
        // Told late: its whole time is ours at the next sample, and then what it played since each one.
        assert_eq!(accounts.sample(|_| Some((5_000, false))), 5_000);
        assert_eq!(accounts.sample(|_| Some((7_000, false))), 2_000);
        // It ends before the next sample: what it played since the last one is still ours, once.
        accounts.remove(1, Some(9_500));
        assert!(!accounts.has(1));
        assert_eq!(accounts.sample(|_| None), 2_500);
        assert_eq!(accounts.sample(|_| None), 0);
        // One that ends on its own is counted and goes; one that cannot be read goes.
        accounts.add(2);
        accounts.add(3);
        assert_eq!(accounts.sample(|pid| (pid == 2).then_some((1_000, true))), 1_000);
        assert!(!accounts.has(2) && !accounts.has(3));
        // Removing one it does not know, or one that cannot be read any more, adds nothing.
        accounts.remove(9, Some(1_000_000));
        accounts.add(4);
        accounts.remove(4, None);
        assert_eq!(accounts.sample(|_| None), 0);
    }
}

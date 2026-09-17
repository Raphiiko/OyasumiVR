#![windows_subsystem = "windows"]

mod native;

use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::windows::{fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const GIB: u64 = 1024 * 1024 * 1024;
const FILE_LIMIT: u64 = 1024 * 1024;
const HISTORY_BYTES: usize = 256 * 1024;
const POLL: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
struct Identity {
    pid: u32,
    created: u64,
}

#[derive(Clone, Debug, Serialize)]
struct Process {
    id: Identity,
    parent: u32,
    name: String,
    private: Option<u64>,
    resident: Option<u64>,
    error: Option<String>,
}

fn directory() -> io::Result<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|dir| PathBuf::from(dir).join("OyasumiVR/memory-watch"))
        .ok_or_else(|| io::Error::other("LOCALAPPDATA is unavailable"))
}

fn text(key: &str) -> String {
    let translations: serde_json::Value =
        serde_json::from_str(include_str!("../../src-ui/assets/i18n/en.json"))
            .expect("English translations");
    translations["memoryWatch"][key]
        .as_str()
        .expect("memory watch translation")
        .to_owned()
}

fn helper() -> io::Result<Command> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(command)
}

fn read_small(path: &Path) -> io::Result<String> {
    let mut result = String::new();
    File::open(path)?
        .take(FILE_LIMIT)
        .read_to_string(&mut result)?;
    Ok(result)
}

fn extra_identity(path: &Path) -> Option<Identity> {
    let content = read_small(path).ok()?;
    let mut parts = content.split_whitespace();
    Some(Identity {
        pid: parts.next()?.parse().ok()?,
        created: parts.next()?.parse().ok()?,
    })
}

fn descendants(all: &[Process], seeds: &HashSet<Identity>) -> HashSet<Identity> {
    let mut found: HashSet<_> = all
        .iter()
        .filter(|p| seeds.contains(&p.id))
        .map(|p| p.id)
        .collect();
    loop {
        let parents: HashMap<_, _> = found.iter().map(|id| (id.pid, id.created)).collect();
        let before = found.len();
        for process in all {
            if process.id.created != 0
                && parents
                    .get(&process.parent)
                    .is_some_and(|created| *created <= process.id.created)
            {
                found.insert(process.id);
            }
        }
        if found.len() == before {
            return found;
        }
    }
}

#[derive(Default)]
struct Trigger {
    high_since: HashMap<Identity, Instant>,
    total_since: Option<Instant>,
}
impl Trigger {
    fn check(&mut self, processes: &[Process], now: Instant) -> Option<Identity> {
        self.high_since.retain(|id, _| {
            processes
                .iter()
                .any(|p| p.id == *id && p.private.is_some_and(|bytes| bytes >= 2 * GIB))
        });
        for process in processes
            .iter()
            .filter(|p| p.private.is_some_and(|bytes| bytes >= 2 * GIB))
        {
            self.high_since.entry(process.id).or_insert(now);
        }
        let total: u64 = processes.iter().filter_map(|p| p.private).sum();
        if total >= 4 * GIB {
            self.total_since.get_or_insert(now);
        } else {
            self.total_since = None;
        }
        let sustained = |started: Instant| now.duration_since(started) >= Duration::from_secs(15);
        let aggregate = self.total_since.is_some_and(sustained);
        processes
            .iter()
            .filter(|p| aggregate || self.high_since.get(&p.id).copied().is_some_and(sustained))
            .max_by_key(|p| p.private.unwrap_or(0))
            .map(|p| p.id)
    }
}

#[derive(Default)]
struct History {
    samples: VecDeque<String>,
    bytes: usize,
}

impl History {
    fn record(&mut self, processes: &[Process], error: Option<&str>) {
        let sample = serde_json::json!({"unixSeconds": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(), "processes": processes, "error": error}).to_string();
        if sample.len() > HISTORY_BYTES {
            return;
        }
        while self.samples.len() >= 120 || self.bytes + sample.len() > HISTORY_BYTES {
            self.bytes -= self.samples.pop_front().unwrap().len();
        }
        self.bytes += sample.len();
        self.samples.push_back(sample);
    }

    fn save(&self, path: &Path) -> io::Result<()> {
        let mut file = File::create(path)?;
        for sample in &self.samples {
            writeln!(file, "{sample}")?;
        }
        Ok(())
    }
}

fn notify(incident: &Path, fallback: Option<&str>) -> io::Result<Child> {
    let mut command = helper()?;
    command.arg("--notify").arg(incident);
    if let Some(fallback) = fallback {
        command.arg(fallback);
    }
    command.spawn()
}

fn capture(
    directory: &Path,
    id: Identity,
    processes: &[Process],
    version: &str,
    logs: &Path,
    history: &History,
) -> io::Result<Child> {
    let incident = directory.join("incident");
    fs::create_dir(&incident)?;
    let incident_guard = native::hold_directory(&incident)?;
    let process = processes.iter().find(|p| p.id == id).unwrap();
    fs::write(
        incident.join("report.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": version, "build": option_env!("OYASUMIVR_BUILD_ID").unwrap_or("unknown"),
            "target": id, "processes": processes,
            "trigger": "2 GiB per process or 4 GiB combined for 15 seconds",
        }))?,
    )?;
    fs::write(
        incident.join("instructions.txt"),
        text("instructions")
            .replace("{pid}", &id.pid.to_string())
            .replace("{name}", &process.name),
    )?;
    history.save(&incident.join("history.jsonl"))?;
    copy_logs(logs, &incident);
    fs::write(incident.join("status.txt"), text("starting"))?;
    let bytes = process
        .private
        .unwrap_or(0)
        .saturating_add(process.resident.unwrap_or(0));
    if native::free_space(&incident)? < bytes.saturating_add(GIB) || bytes > 8 * GIB {
        return Err(io::Error::other(
            "not enough disk space or target exceeds the automatic capture budget",
        ));
    }
    helper()?
        // the inherited handle prevents moving the folder until the writer exits
        .stdin(incident_guard)
        .args(["--dump", &id.pid.to_string(), &id.created.to_string()])
        .arg(&incident)
        .spawn()
}

fn copy_logs(source: &Path, incident: &Path) {
    let Ok(entries) = fs::read_dir(source) else {
        return;
    };
    let mut logs: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            (metadata.is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "log"))
            .then(|| (metadata.modified().ok(), entry.path()))
        })
        .collect();
    logs.sort_by(|a, b| b.0.cmp(&a.0));
    for (index, (_, path)) in logs.into_iter().take(3).enumerate() {
        if let (Ok(input), Ok(mut output)) = (
            File::open(path),
            File::create(incident.join(format!("app-{index}.log"))),
        ) {
            let _ = io::copy(&mut input.take(FILE_LIMIT), &mut output);
        }
    }
}

fn watch(root: Identity, version: &str, logs: &Path, directory: &Path) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let root_handle = native::root_handle(root)?;
    let mut lock = Some(loop {
        if !native::alive(&root_handle) {
            return Ok(());
        }
        match OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .share_mode(0)
            .open(directory.join("watch.lock"))
        {
            Ok(lock) => break lock,
            Err(error) if error.raw_os_error() == Some(32) => std::thread::sleep(POLL),
            Err(error) => return Err(error),
        }
    });
    let own = native::identity(std::process::id())?;
    let extra_path = directory.join(format!("extra-{}.txt", root.pid));
    let incident = directory.join("incident");
    let mut tracked = HashSet::from([root]);
    let mut trigger = Trigger::default();
    let mut history = History::default();
    let mut captured = incident.exists();
    let mut notification = if captured {
        notify(&incident, None).ok()
    } else {
        None
    };
    let mut writer: Option<Child> = None;
    let mut capture_started = None;
    loop {
        let root_alive = native::alive(&root_handle);
        if !root_alive {
            lock.take();
            if writer.is_none() || notification.is_some() {
                break;
            }
        }
        if root_alive {
            // sample the tracked processes
            if let Some(extra) = extra_identity(&extra_path) {
                tracked.insert(extra);
            }
            tracked.insert(root);
            match native::snapshot(&tracked) {
                Ok(all) => {
                    tracked = descendants(&all, &tracked);
                    let excluded = descendants(&all, &HashSet::from([own]));
                    tracked.retain(|id| !excluded.contains(id));
                    let parents: HashSet<_> = tracked.iter().map(|id| id.pid).collect();
                    let mut processes: Vec<_> = all
                        .into_iter()
                        .filter(|p| {
                            tracked.contains(&p.id)
                                || (p.id.created == 0 && parents.contains(&p.parent))
                        })
                        .collect();
                    for process in &mut processes {
                        native::measure(process);
                    }
                    history.record(&processes, None);
                    // capture the first sustained threshold breach
                    if !captured {
                        if let Some(id) = trigger.check(&processes, Instant::now()) {
                            captured = true;
                            match capture(directory, id, &processes, version, logs, &history) {
                                Ok(child) => {
                                    writer = Some(child);
                                    capture_started = Some(Instant::now());
                                }
                                Err(error) => {
                                    let status =
                                        text("failed").replace("{error}", &error.to_string());
                                    let _ = fs::write(incident.join("status.txt"), &status);
                                    let name = processes
                                        .iter()
                                        .find(|p| p.id == id)
                                        .map_or("OyasumiVR", |p| p.name.as_str());
                                    let fallback = format!(
                                        "{status}\n\n{}",
                                        text("manualFallback")
                                            .replace("{pid}", &id.pid.to_string())
                                            .replace("{name}", name)
                                    );
                                    notification = notify(&incident, Some(&fallback)).ok();
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    history.record(&[], Some(&error.to_string()));
                    trigger = Trigger::default();
                }
            }
        }
        // check the independent dump writer
        if let Some(child) = writer.as_mut() {
            if let Some(status) = child.try_wait()? {
                if !status.success()
                    && read_small(&incident.join("status.txt"))
                        .is_ok_and(|status| status == text("starting"))
                {
                    let _ = fs::write(incident.join("status.txt"), text("unexpectedExit"));
                }
                writer = None;
                if notification.is_none() {
                    notification = notify(&incident, None).ok();
                }
            } else if capture_started
                .is_some_and(|started| started.elapsed() > Duration::from_secs(150))
                && notification.is_none()
            {
                notification = notify(&incident, None).ok();
            }
        }
        std::thread::sleep(POLL);
    }
    let _ = fs::remove_file(extra_path);
    Ok(())
}

fn run() -> io::Result<()> {
    let args: Vec<_> = std::env::args_os().collect();
    let directory = directory()?;
    match args.get(1).and_then(|arg| arg.to_str()) {
        Some("--watch") if args.len() == 6 => {
            let pid = args[2]
                .to_string_lossy()
                .parse()
                .map_err(io::Error::other)?;
            watch(
                Identity {
                    pid,
                    created: args[3]
                        .to_string_lossy()
                        .parse()
                        .map_err(io::Error::other)?,
                },
                &args[4].to_string_lossy(),
                Path::new(&args[5]),
                &directory,
            )?;
        }
        Some("--dump") if args.len() == 5 => {
            let id = Identity {
                pid: args[2]
                    .to_string_lossy()
                    .parse()
                    .map_err(io::Error::other)?,
                created: args[3]
                    .to_string_lossy()
                    .parse()
                    .map_err(io::Error::other)?,
            };
            let incident = Path::new(&args[4]);
            let partial = incident.join("process.dmp.partial");
            let result = native::dump(id, &partial)
                .and_then(|_| fs::rename(&partial, incident.join("process.dmp")));
            let status = match &result {
                Ok(()) => text("saved"),
                Err(error) => {
                    let _ = fs::remove_file(partial);
                    text("failed").replace("{error}", &error.to_string())
                }
            };
            fs::write(incident.join("status.txt"), status)?;
            result?;
        }
        Some("--notify") if args.len() == 3 || args.len() == 4 => {
            let incident = Path::new(&args[2]);
            let notification_lock = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .share_mode(0)
                .open(directory.join("notification.lock"));
            if notification_lock
                .as_ref()
                .is_err_and(|error| error.raw_os_error() == Some(32))
            {
                return Ok(());
            }
            let status = read_small(&incident.join("status.txt")).unwrap_or_else(|_| {
                args.get(3)
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .unwrap_or_else(|| text("missingReport"))
            });
            let message = text("notification")
                .replace("{status}", &status)
                .replace("{path}", &incident.display().to_string());
            if native::message(&message) {
                let folder: PathBuf = incident.components().collect();
                Command::new("explorer.exe").arg(folder).spawn()?;
            }
        }
        _ => return Err(io::Error::other("invalid memory-watch arguments")),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        if let Ok(directory) = directory() {
            let _ = fs::create_dir_all(&directory);
            let _ = fs::write(directory.join("watch-error.txt"), error.to_string());
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests;

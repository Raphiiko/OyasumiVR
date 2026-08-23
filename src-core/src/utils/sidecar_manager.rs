use log::{error, info, warn};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};

// Liveness check for a process we did not spawn ourselves, and therefore have no Child
// handle for. Opening a handle by pid is authoritative, unlike scanning the process table.
fn process_is_running(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    const SYNCHRONIZE: u32 = 0x0010_0000;
    unsafe {
        let handle = OpenProcess(SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let running = WaitForSingleObject(handle, 0) != WAIT_OBJECT_0;
        CloseHandle(handle);
        running
    }
}

/// Resolves a configured sidecar path for the shell, which needs an absolute path and backslashes
/// where `Command` accepts neither.
fn absolute(path: &std::path::Path) -> std::path::PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    let base = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf));
    let joined = match base {
        Some(base) => base.join(path),
        None => path.to_path_buf(),
    };
    // the configured directories use forward slashes
    std::path::PathBuf::from(joined.to_string_lossy().replace('/', "\\"))
}

const LAUNCH_RETRY_INTERVALS: [Duration; 9] = [
    Duration::from_millis(100),
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
];

/// How a sidecar gets started.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SidecarLaunch {
    /// Plain child process.
    Spawn,
    /// Through the privileged launcher's scheduled task. Elevated, no prompt.
    ScheduledTask,
    /// Directly, with a UAC prompt on every launch.
    ElevatedSpawn,
}

#[derive(Clone)]
#[readonly::make]
pub struct SidecarManager {
    pub sidecar_id: String,
    pub exe_file: String,
    pub exe_dir: String,
    pub grpc_port: Arc<Mutex<Option<u32>>>,
    pub grpc_web_port: Arc<Mutex<Option<u32>>>,
    pub active: Arc<Mutex<bool>>,
    pub started: Arc<Mutex<bool>>,
    pub sidecar_pid: Arc<Mutex<Option<u32>>>,
    pub sidecar_child: Arc<Mutex<Option<std::process::Child>>>,
    pub watching: Arc<Mutex<bool>>,
    pub on_stop_tx: mpsc::Sender<bool>,
    pub expected_stop: Arc<AtomicBool>,
    pub auto_restart: bool,
    pub args: Arc<Mutex<Vec<String>>>,
    pub restart_requested: Arc<tokio::sync::Notify>,
    pub launching: Arc<Mutex<()>>,
    pub launch: SidecarLaunch,
    /// Incremented on every launch. A watcher only touches shared state while its own generation
    /// is current, so a stop and a quick restart cannot have the old watcher clear the new state.
    pub generation: Arc<std::sync::atomic::AtomicU64>,
}

impl SidecarManager {
    pub fn new(
        sidecar_id: String,
        exe_dir: String,
        exe_file: String,
        on_stop_tx: mpsc::Sender<bool>,
        auto_restart: bool,
        args: Vec<String>,
        launch: SidecarLaunch,
    ) -> Self {
        Self {
            sidecar_id,
            exe_file,
            exe_dir,
            grpc_port: Arc::new(Mutex::new(None)),
            grpc_web_port: Arc::new(Mutex::new(None)),
            active: Arc::new(Mutex::new(false)),
            started: Arc::new(Mutex::new(false)),
            sidecar_pid: Arc::new(Mutex::new(None)),
            sidecar_child: Arc::new(Mutex::new(None)),
            watching: Arc::new(Mutex::new(false)),
            on_stop_tx,
            expected_stop: Arc::new(AtomicBool::new(false)),
            auto_restart,
            args: Arc::new(Mutex::new(args)),
            restart_requested: Arc::new(tokio::sync::Notify::new()),
            launching: Arc::new(Mutex::new(())),
            launch,
            generation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }


    pub async fn set_arg(&mut self, arg: &str, value: bool, unique: bool) {
        let mut args_guard = self.args.lock().await;
        let arg = String::from(arg);
        if value {
            if !unique || !args_guard.contains(&arg) {
                args_guard.push(arg);
            }
        } else if let Some(index) = args_guard.iter().position(|x| *x == arg) {
            args_guard.remove(index);
        }
    }

    #[allow(dead_code)]
    pub async fn set_args(&mut self, args: Vec<String>) {
        *self.args.lock().await = args;
    }

    pub async fn start_or_restart(&mut self) {
        // Wait out a launch that is already in flight, so that its process cannot escape the
        // kill below and keep running with the arguments it was given.
        let watching = {
            let _launching = self.launching.lock().await;
            let mut sidecar_child = self.sidecar_child.lock().await;
            if let Some(sidecar_child) = sidecar_child.as_mut() {
                info!(
                    "[Core] Killing running {} sidecar to prepare for restart...",
                    self.sidecar_id
                );
                match sidecar_child.kill() {
                    Ok(()) => self.expected_stop.store(true, Ordering::Relaxed),
                    Err(e) => {
                        error!("[Core] Failed to kill {} sidecar: {}", self.sidecar_id, e)
                    }
                }
            }
            *self.watching.lock().await
        };
        // A running watcher picks the restart up by itself. Starting one here as well would
        // leave two processes and two watchers running alongside each other.
        if watching {
            self.restart_requested.notify_one();
        } else {
            self._start_internal(false).await;
        }
    }

    /// Whether the launch was initiated. On the scheduled task path the sidecar reports in later.
    pub async fn start(&mut self) -> bool {
        self._start_internal(false).await
    }

    async fn _start_internal(&mut self, relaunch: bool) -> bool {
        // held until the new process is stored, so start_or_restart cannot miss it
        let _launching = self.launching.lock().await;
        let core_grpc_port_guard = crate::grpc::SERVER_PORT.lock().await;
        let core_grpc_port = match core_grpc_port_guard.as_ref() {
            Some(port) => *port,
            None => return false,
        };
        if !relaunch && *self.active.lock().await {
            return false;
        }
        *self.active.lock().await = true;
        self.generation.fetch_add(1, Ordering::Relaxed);
        info!(
            "[Core] {} {} sidecar...",
            match relaunch {
                true => "Restarting",
                false => "Starting",
            },
            self.sidecar_id
        );
        let exe_file = self.exe_file.clone();
        let exe_dir = self.exe_dir.clone();
        let exe_path = std::path::Path::new(&exe_dir).join(&exe_file);
        let mut args = vec![
            format!("--core-grpc-port={core_grpc_port}"),
            format!("--core-pid={}", std::process::id()),
        ];
        {
            let extra_args = self.args.lock().await;
            for arg in extra_args.iter() {
                args.push(arg.clone());
            }
        }
        // the task takes no arguments, so the sidecar reads these from the handshake instead
        if self.launch == SidecarLaunch::ScheduledTask {
            return self.start_through_task(core_grpc_port).await;
        }

        let launch_result = match self.launch {
            SidecarLaunch::ElevatedSpawn => crate::elevated_sidecar::elevate::spawn(
                &absolute(&exe_path),
                &args.join(" "),
            )
            .map(|pid| (pid, None))
            .map_err(|e| e.to_string()),
            _ => std::process::Command::new(&exe_path)
                .current_dir(exe_dir)
                .args(args)
                .spawn()
                .map(|child| (child.id(), Some(child)))
                .map_err(|e| e.to_string()),
        };

        let (child_pid, child) = match launch_result {
            Ok(started) => started,
            Err(e) => {
                error!(
                    "[Core] Could not start {} sidecar ({}): {}",
                    self.sidecar_id,
                    exe_path.display(),
                    e
                );
                *self.active.lock().await = false;
                let _ = self.on_stop_tx.send(false).await;
                // a launch that never happened still needs a watcher, or it is never retried
                if !relaunch && !*self.watching.lock().await {
                    *self.watching.lock().await = true;
                    self.watch_process();
                }
                return false;
            }
        };
        *self.sidecar_pid.lock().await = Some(child_pid);
        *self.sidecar_child.lock().await = child;
        if !relaunch && !*self.watching.lock().await {
            *self.watching.lock().await = true;
            self.watch_process();
        }
        true
    }

    /// Writes the handshake, starts the task, and returns without waiting for the sidecar.
    ///
    /// Must not wait: callers hold the module level `SIDECAR_MANAGER` lock, which the gRPC handler
    /// delivering the start signal also needs. `handle_start_signal` records the pid and starts the
    /// watcher.
    async fn start_through_task(&self, core_grpc_port: u32) -> bool {
        let Some(sidecar_path) = crate::elevated_sidecar::launcher::bundled_sidecar() else {
            error!("[Core] Cannot find the bundled elevated sidecar");
            *self.active.lock().await = false;
            let _ = self.on_stop_tx.send(false).await;
            return false;
        };
        let handshake = oyasumivr_shared::handshake::Handshake::new(
            core_grpc_port,
            std::process::id(),
            sidecar_path,
        );
        if let Err(e) = handshake.write() {
            error!("[Core] Could not write the elevated sidecar handshake: {e}");
            *self.active.lock().await = false;
            let _ = self.on_stop_tx.send(false).await;
            return false;
        }
        if let Err(e) = crate::elevated_sidecar::launcher::trigger() {
            error!("[Core] Could not start the privileged launcher task: {e}");
            *self.active.lock().await = false;
            let _ = self.on_stop_tx.send(false).await;
            return false;
        }
        self.give_up_if_the_sidecar_never_reports_in();
        true
    }

    /// Clears `active` when no sidecar ever reports in, which nothing else does on the task path
    /// because there is no child process to watch until then.
    fn give_up_if_the_sidecar_never_reports_in(&self) {
        let manager = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(20)).await;
            if *manager.started.lock().await {
                return;
            }
            let mut active = manager.active.lock().await;
            if !*active {
                return;
            }
            *active = false;
            drop(active);
            let launcher_said = crate::elevated_sidecar::launcher::last_launcher_result()
                .map(crate::elevated_sidecar::launcher::describe_launcher_result)
                .unwrap_or("no result from the launcher");
            error!(
                "[Core] The {} sidecar never reported in: {}",
                manager.sidecar_id, launcher_said
            );
            let _ = manager.on_stop_tx.send(true).await;
        });
    }

    /// Stops the sidecar and leaves the manager idle, so the next start is accepted. Used by the
    /// settings toggle: it stops the process but leaves the launcher and its task installed, so
    /// turning it back on costs nothing.
    pub async fn stop_and_stay_stopped(&mut self) {
        self.expected_stop.store(true, Ordering::Relaxed);
        if let Some(child) = self.sidecar_child.lock().await.as_mut() {
            let _ = child.kill();
        } else if let Some(pid) = *self.sidecar_pid.lock().await {
            // An elevated sidecar has no handle here and cannot be terminated from this process,
            // so a stop it did not honour over gRPC leaves it running.
            if pid != 0 && process_is_running(pid) {
                warn!(
                    "[Core] {} sidecar (pid {}) did not stop when asked",
                    self.sidecar_id, pid
                );
            }
        }
        // Cleared so a restart is not rejected for carrying a different pid than this one.
        *self.sidecar_pid.lock().await = None;
        *self.sidecar_child.lock().await = None;
        *self.active.lock().await = false;
        *self.started.lock().await = false;
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    // The sidecar process is running
    #[allow(dead_code)]
    pub async fn is_active(&self) -> bool {
        *self.active.lock().await
    }

    // The sidecar process is running, and the sidecar has signalled it has started
    pub async fn has_started(&self) -> bool {
        *self.started.lock().await
    }

    pub async fn handle_start_signal(
        &self,
        grpc_port: Option<u32>,
        grpc_web_port: Option<u32>,
        pid: u32,
    ) -> bool {
        // pid == 0 means that we are assuming the sidecar is running in development mode.
        if pid != 0 {
            // A sidecar we did not ask for gets refused. Anyone able to trigger the launcher's
            // task can start one, and it must not be left running with its privileged gRPC
            // servers open.
            if !*self.active.lock().await {
                warn!(
                    "[Core] Ignoring start signal for {} sidecar with pid {} because it is not active",
                    self.sidecar_id, pid
                );
                return false;
            }
            // If another sidecar is already running, only accept this signal from that same
            // process. On the task path we have no pid until this signal arrives, so None here
            // means "we asked for one and this is it".
            let current_pid = *self.sidecar_pid.lock().await;
            if let Some(current_pid) = current_pid {
                if current_pid != pid {
                    warn!("[Core] Ignoring start signal for {} sidecar with pid {} because another {} sidecar is already running with pid {}", self.sidecar_id, pid, self.sidecar_id, current_pid);
                    return false;
                }
            }
        } else {
            // We already expect it to run in development mode
            *self.active.lock().await = true;
        }
        // Store started state
        *self.started.lock().await = true;
        // Update the known pid
        *self.sidecar_pid.lock().await = Some(pid);
        // On the task path the core never spawned anything, so this signal is the first time we
        // learn the pid. Adopt it with a fresh watcher, or its death would go unnoticed and the
        // manager would stay active forever, refusing every later start.
        if pid != 0 && !*self.watching.lock().await {
            *self.watching.lock().await = true;
            self.watch_process();
        }
        // Store the GRPC ports
        *self.grpc_port.lock().await = grpc_port;
        *self.grpc_web_port.lock().await = grpc_web_port;
        info!(
            "[Core] Detected start of {} sidecar (pid={}, grpc_port={:?}, grpc_web_port={:?})",
            self.sidecar_id, pid, grpc_port, grpc_web_port
        );
        true
    }

    fn watch_process(&self) {
        let mut manager = self.clone();
        let generation = manager.generation.load(Ordering::Relaxed);

        tokio::spawn(async move {
            let last_retry_interval = LAUNCH_RETRY_INTERVALS.len() - 1;
            let mut retries = 0;
            loop {
                // A pid of 0 means the last launch attempt failed, so there is nothing to
                // watch and we go straight to backing off and trying again.
                let pid = (*manager.sidecar_pid.lock().await).unwrap_or(0);
                if pid != 0 {
                    let mut alive_polls: u32 = 0;
                    loop {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        let exited = {
                            let mut child_guard = manager.sidecar_child.lock().await;
                            match child_guard.as_mut() {
                                Some(child) => child.try_wait().map(|s| s.is_some()).unwrap_or(true),
                                None => !process_is_running(pid),
                            }
                        };
                        if exited {
                            break;
                        }
                        // Only consider the sidecar stable (and reset the restart backoff)
                        // once it has stayed alive for a while, so that a sidecar that
                        // repeatedly crashes shortly after starting doesn't get restarted
                        // every few seconds indefinitely.
                        alive_polls += 1;
                        if alive_polls >= 20 {
                            retries = 0;
                        }
                    }
                    if manager.generation.load(Ordering::Relaxed) != generation {
                        // A stop or a newer launch already took over this state.
                        break;
                    }
                    *manager.sidecar_pid.lock().await = None;
                    *manager.sidecar_child.lock().await = None;
                    *manager.grpc_port.lock().await = None;
                    *manager.grpc_web_port.lock().await = None;
                    *manager.active.lock().await = false;
                    *manager.started.lock().await = false;
                    info!(
                        "[Core] {} sidecar has stopped (pid={})",
                        manager.sidecar_id, pid
                    );
                    // Send signal that the sidecar has stopped
                    let unexpected = !manager.expected_stop.swap(false, Ordering::Relaxed);
                    let _ = manager.on_stop_tx.send(unexpected).await;
                }
                if !manager.auto_restart {
                    break;
                }
                // an explicit restart request must not wait out the backoff
                tokio::select! {
                    _ = tokio::time::sleep(LAUNCH_RETRY_INTERVALS[retries]) => {
                        retries = (retries + 1).min(last_retry_interval);
                    }
                    _ = manager.restart_requested.notified() => {
                        retries = 0;
                    }
                }
                manager._start_internal(true).await;
            }
            *manager.watching.lock().await = false;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::absolute;
    use std::path::Path;

    #[test]
    fn relative_sidecar_paths_become_absolute_with_backslashes() {
        let resolved = absolute(Path::new("resources/elevated-sidecar/sidecar.exe"));
        assert!(resolved.is_absolute(), "{}", resolved.display());
        let text = resolved.to_string_lossy();
        assert!(!text.contains('/'), "forward slashes left in {text}");
        assert!(text.ends_with(r"resources\elevated-sidecar\sidecar.exe"), "{text}");
    }

    #[tokio::test]
    async fn stopping_clears_the_pid_and_moves_the_generation_on() {
        let (tx, _rx) = tokio::sync::mpsc::channel(4);
        let mut manager = super::SidecarManager::new(
            "TEST".to_string(),
            "resources/".to_string(),
            "x.exe".to_string(),
            tx,
            false,
            vec![],
            super::SidecarLaunch::ScheduledTask,
        );
        *manager.sidecar_pid.lock().await = Some(4321);
        *manager.active.lock().await = true;
        *manager.started.lock().await = true;
        let before = manager.generation.load(std::sync::atomic::Ordering::Relaxed);

        manager.stop_and_stay_stopped().await;

        // A stale pid would make handle_start_signal reject the next sidecar.
        assert_eq!(*manager.sidecar_pid.lock().await, None);
        assert!(!*manager.active.lock().await);
        assert!(!*manager.started.lock().await);
        assert!(manager.generation.load(std::sync::atomic::Ordering::Relaxed) > before);
    }

    #[test]
    fn absolute_paths_are_left_alone() {
        let given = Path::new(r"C:\Program Files\OyasumiVR\x.exe");
        assert_eq!(absolute(given), given);
    }
}

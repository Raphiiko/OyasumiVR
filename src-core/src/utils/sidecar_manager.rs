use log::{error, info, warn};
use std::sync::Arc;
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
    pub on_stop_tx: mpsc::Sender<()>,
    pub auto_restart: bool,
    pub args: Arc<Mutex<Vec<String>>>,
}

impl SidecarManager {
    pub fn new(
        sidecar_id: String,
        exe_dir: String,
        exe_file: String,
        on_stop_tx: mpsc::Sender<()>,
        auto_restart: bool,
        args: Vec<String>,
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
            auto_restart,
            args: Arc::new(Mutex::new(args)),
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
        // Kill whatever process we are currently holding, if any.
        {
            let mut sidecar_child = self.sidecar_child.lock().await;
            if let Some(sidecar_child) = sidecar_child.as_mut() {
                info!(
                    "[Core] Killing running {} sidecar to prepare for restart...",
                    self.sidecar_id
                );
                if let Err(e) = sidecar_child.kill() {
                    error!("[Core] Failed to kill {} sidecar: {}", self.sidecar_id, e);
                }
            }
        }
        // A running watcher picks the restart up by itself. Starting one here as well would
        // leave two processes and two watchers running alongside each other.
        if !*self.watching.lock().await {
            self._start_internal(false).await;
        }
    }

    pub async fn start(&mut self) -> u32 {
        self._start_internal(false).await
    }

    async fn _start_internal(&mut self, relaunch: bool) -> u32 {
        let core_grpc_port_guard = crate::grpc::SERVER_PORT.lock().await;
        let core_grpc_port = match core_grpc_port_guard.as_ref() {
            Some(port) => *port,
            None => return 0,
        };
        if !relaunch && *self.active.lock().await {
            return 0;
        }
        *self.active.lock().await = true;
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
        let child = match std::process::Command::new(&exe_path)
            .current_dir(exe_dir)
            .args(args)
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                error!(
                    "[Core] Could not start {} sidecar ({}): {}",
                    self.sidecar_id,
                    exe_path.display(),
                    e
                );
                *self.active.lock().await = false;
                return 0;
            }
        };
        let child_pid = child.id();
        *self.sidecar_pid.lock().await = Some(child_pid);
        *self.sidecar_child.lock().await = Some(child);
        if !relaunch && !*self.watching.lock().await {
            *self.watching.lock().await = true;
            self.watch_process();
        }
        child_pid
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
        old_pid: Option<u32>,
    ) -> bool {
        // pid == 0 means that we are assuming the sidecar is running in development mode.
        if pid != 0 {
            // If the sidecar is not active, ignore this signal, unless it carries an old pid
            // and therefore comes from a process that replaced one we started.
            if !*self.active.lock().await {
                if old_pid.is_none() {
                    warn!(
                        "[Core] Ignoring start signal for {} sidecar with pid {} because it is not active",
                        self.sidecar_id, pid
                    );
                    return false;
                }
                *self.active.lock().await = true;
            }
            // If another sidecar is already running, only accept this signal when it comes
            // from that same process, or from a process that replaced it.
            let current_pid = *self.sidecar_pid.lock().await;
            if let Some(current_pid) = current_pid {
                if current_pid != pid && old_pid != Some(current_pid) {
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
        // A sidecar that relaunched itself through UAC reports in after the watcher for the
        // process we spawned has already given up, so adopt it with a fresh watcher.
        // Without one, its death would go unnoticed and the manager would stay active
        // forever, refusing every later start.
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
                    // A changed pid means the sidecar replaced itself with a process we did
                    // not spawn (the elevated sidecar relaunches itself through UAC). Adopt
                    // it and keep watching, by pid rather than by handle.
                    let current_sidecar_pid = *manager.sidecar_pid.lock().await;
                    match current_sidecar_pid {
                        Some(current_sidecar_pid) if current_sidecar_pid != pid => {
                            info!(
                                "[Core] {} sidecar with pid {} was replaced by pid {}",
                                manager.sidecar_id, pid, current_sidecar_pid
                            );
                            *manager.sidecar_child.lock().await = None;
                            continue;
                        }
                        _ => {}
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
                    let _ = manager.on_stop_tx.send(()).await;
                }
                if !manager.auto_restart {
                    break;
                }
                tokio::time::sleep(LAUNCH_RETRY_INTERVALS[retries]).await;
                retries = (retries + 1).min(last_retry_interval);
                manager._start_internal(true).await;
            }
            *manager.watching.lock().await = false;
        });
    }
}

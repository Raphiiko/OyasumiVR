use log::{error, info, warn};
use std::sync::Arc;
use std::time::Duration;
use sysinfo::{Pid, System};
use tokio::sync::{mpsc, Mutex};

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
        let active = *self.active.lock().await;
        // Kill process if it is already active
        if active {
            info!(
                "[Core] Killing running {} sidecar to prepare for restart...",
                self.sidecar_id
            );
            let mut sidecar_child = self.sidecar_child.lock().await;
            if let Some(sidecar_child) = sidecar_child.as_mut() {
                if let Err(e) = sidecar_child.kill() {
                    error!("[Core] Failed to kill {} sidecar: {}", self.sidecar_id, e);
                }
            }
        }
        // Start the process if it was not already running, or if auto_restart is not set
        if !active || !self.auto_restart {
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
            format!("{core_grpc_port}"),
            format!("{}", std::process::id()),
        ];
        {
            let extra_args = self.args.lock().await;
            for arg in extra_args.iter() {
                args.push(arg.clone());
            }
        }
        let child = std::process::Command::new(exe_path)
            .current_dir(exe_dir)
            .args(args)
            .spawn()
            .expect("Could not spawn command");
        let child_pid = child.id();
        *self.sidecar_pid.lock().await = Some(child_pid);
        *self.sidecar_child.lock().await = Some(child);
        if !relaunch {
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
            // If the sidecar is not active, ignore this signal
            let active_guard = self.active.lock().await;
            if !*active_guard {
                warn!(
                    "Ignoring start signal for {} sidecar with pid {} because it is not active",
                    self.sidecar_id, pid
                );
                return false;
            }
            // If another sidecar is already running that does not have the old pid, ignore this signal
            let current_pid = self.sidecar_pid.lock().await;
            if current_pid.is_some()
                && (current_pid.unwrap() != pid
                    && (old_pid.is_some() && current_pid.unwrap() != old_pid.unwrap()))
            {
                warn!("Ignoring start signal for {} sidecar with pid {} because another {} sidecar is already running with pid {}", self.sidecar_id, pid, self.sidecar_id, current_pid.unwrap());
                return false;
            }
        } else {
            // We already expect it to run in development mode
            *self.active.lock().await = true;
        }
        // Store started state
        *self.started.lock().await = true;
        // Update the known pid
        *self.sidecar_pid.lock().await = Some(pid);
        // Store the GRPC ports
        *self.grpc_port.lock().await = grpc_port;
        *self.grpc_web_port.lock().await = grpc_web_port;
        info!(
            "[Core] Detected start of {} sidecar (pid={}, grpc_port={:?}, grpc_web_port={:?})",
            self.sidecar_id, pid, grpc_port, grpc_web_port
        );
        true
    }

    fn watch_process(&mut self) {
        let mut s = System::new_all();
        let self_arc = Arc::new(Mutex::new(self.clone()));

        tokio::spawn(async move {
            let mut retries = 0;
            let mut pid = {
                let self_guard = self_arc.lock().await;
                let value = match self_guard.sidecar_pid.lock().await.as_ref() {
                    Some(pid) => *pid,
                    None => {
                        error!("[Core] Tried watching non-existant sidecar process");
                        return;
                    }
                };
                value
            };
            loop {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let self_guard = self_arc.lock().await;
                    s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                    // Check if the child process is no longer found
                    if s.process(Pid::from(pid as usize)).is_none() {
                        let current_sidecar_pid = {
                            self_guard.sidecar_pid.lock().await.as_ref().map(|pid| *pid)
                        };
                        // Check if the sidecar pid is still the same.
                        // If it is, then we can assume the sidecar stopped.
                        // If not, it likely got replaced by another instance of the sidecar.
                        if match current_sidecar_pid {
                            Some(current_sidecar_pid) => current_sidecar_pid == pid,
                            None => true,
                        } {
                            let sidecar_pid = &self_guard.sidecar_pid;
                            *sidecar_pid.lock().await = None;
                            let sidecar_child = &self_guard.sidecar_child;
                            *sidecar_child.lock().await = None;
                            let grpc_port = &self_guard.grpc_port;
                            *grpc_port.lock().await = None;
                            let grpc_web_port = &self_guard.grpc_web_port;
                            *grpc_web_port.lock().await = None;
                            let active = &self_guard.active;
                            *active.lock().await = false;
                            let started = &self_guard.started;
                            *started.lock().await = false;
                        }
                        // Send signal that the sidecar has stopped
                        let _ = &self_guard.on_stop_tx.send(());
                        info!(
                            "[Core] {} sidecar has stopped (pid={})",
                            &self_guard.sidecar_id, pid
                        );
                        break;
                    } else {
                        retries = 0;
                    }
                    // Drop the lock here before the next iteration
                    drop(self_guard);
                }
                // Automatically try restarting the sidecar if desired
                if self_arc.lock().await.auto_restart {
                    let retry_interval = LAUNCH_RETRY_INTERVALS[retries];
                    tokio::time::sleep(retry_interval).await;
                    retries += 1;
                    if retries >= LAUNCH_RETRY_INTERVALS.len() {
                        retries = LAUNCH_RETRY_INTERVALS.len() - 1;
                    }
                    // KICKSTART THE SIDECAR
                    pid = self_arc.lock().await._start_internal(true).await;
                    continue;
                }
                break;
            }
        });
    }
}

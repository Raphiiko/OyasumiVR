use log::{info, warn};
use std::sync::Arc;
use std::time::Duration;
use sysinfo::{Pid, PidExt, System, SystemExt};
use tokio::sync::{mpsc, Mutex};

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
    pub on_stop_tx: mpsc::Sender<()>,
}

impl SidecarManager {
    pub fn new(
        sidecar_id: String,
        exe_dir: String,
        exe_file: String,
        on_stop_tx: mpsc::Sender<()>,
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
            on_stop_tx,
        }
    }

    pub async fn start(&mut self) {
        let core_grpc_port_guard = crate::grpc::SERVER_PORT.lock().await;
        let core_grpc_port = match core_grpc_port_guard.as_ref() {
            Some(port) => *port,
            None => return,
        };
        if *self.active.lock().await {
            return;
        }
        *self.active.lock().await = true;
        info!("[Core] Starting {} sidecar...", self.sidecar_id);
        let exe_file = self.exe_file.clone();
        let exe_dir = self.exe_dir.clone();
        let exe_path = std::path::Path::new(&exe_dir).join(&exe_file);
        let child = std::process::Command::new(exe_path)
            .current_dir(exe_dir)
            .args(vec![
                format!("{core_grpc_port}"),
                format!("{}", std::process::id()),
            ])
            .spawn()
            .expect("Could not spawn command");
        *self.sidecar_pid.lock().await = Some(child.id());
        self.watch_process();
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
        grpc_port: u32,
        grpc_web_port: u32,
        pid: u32,
        old_pid: Option<u32>,
    ) -> bool {
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
        // Store started state
        *self.started.lock().await = true;
        // Store the GRPC ports
        *self.grpc_port.lock().await = Some(grpc_port);
        *self.grpc_web_port.lock().await = Some(grpc_web_port);
        info!(
            "[Core] Detected start of {} sidecar (pid={}, grpc_port={}, grpc_web_port={})",
            self.sidecar_id, pid, grpc_port, grpc_web_port
        );
        return true;
    }

    fn watch_process(&mut self) {
        let mut s = System::new_all();
        let self_arc = Arc::new(Mutex::new(self.clone()));

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let pid = match self_arc.lock().await.sidecar_pid.lock().await.as_ref() {
                    Some(pid) => *pid,
                    None => break,
                };
                let self_guard = self_arc.lock().await;
                s.refresh_processes();
                if s.process(Pid::from_u32(pid)).is_none() {
                    let current_sidecar_pid_guard = &self_guard.sidecar_pid.lock().await;
                    let current_sidecar_pid = current_sidecar_pid_guard.as_ref();
                    if match current_sidecar_pid {
                        Some(current_sidecar_pid) => *current_sidecar_pid == pid,
                        None => true,
                    } {
                        let sidecar_pid = &self_guard.sidecar_pid;
                        *sidecar_pid.lock().await = None;
                        let grpc_port = &self_guard.grpc_port;
                        *grpc_port.lock().await = None;
                        let active = &self_guard.active;
                        *active.lock().await = false;
                        let started = &self_guard.started;
                        *started.lock().await = false;
                    }
                    let _ = &self_guard.on_stop_tx.send(());
                    info!(
                        "[Core] {} sidecar has stopped (pid={})",
                        &self_guard.sidecar_id, pid
                    );
                    break;
                }
                // Drop the lock here before the next iteration
                drop(self_guard);
            }
        });
    }
}

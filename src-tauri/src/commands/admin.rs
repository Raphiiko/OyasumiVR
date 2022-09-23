use futures::executor::block_on;

use crate::elevated_sidecar;

#[tauri::command]
pub async fn elevation_sidecar_running() -> Option<u32> {
    elevated_sidecar::active().await
}

#[tauri::command]
pub fn start_elevation_sidecar() {
    std::thread::spawn(|| {
        let future = elevated_sidecar::start();
        block_on(future);
    });
}

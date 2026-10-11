use std::time::Duration;

use log::{error, info};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{ReportSources, MAX_REPORT_BYTES, UPLOAD_URL};

/// Builds a debug report and keeps it for `debug_report_upload` and `debug_report_save`.
/// Returns the zip size in bytes.
#[tauri::command]
pub async fn debug_report_create(app_handle: AppHandle, ui_state: Value) -> Result<usize, String> {
    let path = app_handle.path();
    let sources = ReportSources {
        app_data_dir: path.app_data_dir().map_err(|e| e.to_string())?,
        log_dir: path.app_log_dir().map_err(|e| e.to_string())?,
        ui_state,
    };
    let size = super::create(sources).await.inspect_err(|e| {
        error!("[Core] Could not create the debug report: {e}");
    })?;
    info!("[Core] Created a debug report of {size} bytes");
    Ok(size)
}

#[derive(Deserialize)]
struct UploadResponse {
    code: String,
}

/// Uploads the pending debug report and returns its report code.
/// Fails with `REPORT_TOO_LARGE` without a request when the zip exceeds the endpoint limit.
#[tauri::command]
pub async fn debug_report_upload() -> Result<String, String> {
    let zip = super::pending_report()
        .await
        .ok_or_else(|| "NO_PENDING_REPORT".to_string())?;
    if zip.len() > MAX_REPORT_BYTES {
        info!(
            "[Core] The debug report is {} bytes, too large to upload",
            zip.len()
        );
        return Err("REPORT_TOO_LARGE".into());
    }
    let response = reqwest::Client::new()
        .post(UPLOAD_URL)
        .header(reqwest::header::CONTENT_TYPE, "application/zip")
        .timeout(Duration::from_secs(120))
        .body(zip)
        .send()
        .await
        .map_err(|e| {
            error!("[Core] Could not upload the debug report: {e}");
            "UPLOAD_FAILED".to_string()
        })?;
    let status = response.status();
    if !status.is_success() {
        error!("[Core] The debug report upload returned {status}");
        return Err("UPLOAD_FAILED".into());
    }
    let body: UploadResponse = response.json().await.map_err(|e| {
        error!("[Core] Could not read the debug report upload response: {e}");
        "UPLOAD_FAILED".to_string()
    })?;
    info!("[Core] Uploaded a debug report as {}", body.code);
    Ok(body.code)
}

/// Writes the pending debug report to `path`.
#[tauri::command]
pub async fn debug_report_save(path: String) -> Result<(), String> {
    let zip = super::pending_report()
        .await
        .ok_or_else(|| "NO_PENDING_REPORT".to_string())?;
    tokio::fs::write(&path, zip).await.map_err(|e| {
        error!("[Core] Could not save the debug report: {e}");
        "SAVE_FAILED".to_string()
    })
}

/// Drops the pending debug report from memory, once neither a retry nor a save needs it.
#[tauri::command]
pub async fn debug_report_discard() {
    super::discard().await;
}

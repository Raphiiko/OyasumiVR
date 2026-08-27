use std::{collections::BTreeMap, path::PathBuf};

use log::info;
use tauri::{AppHandle, Manager};

use super::{base_dir, store_file_path, CheckpointMetadata};

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the app data directory: {e}"))
}

#[tauri::command]
pub async fn store_safety_save_snapshot(
    app_handle: AppHandle,
    store_name: String,
    contents: String,
) -> Result<(), String> {
    let base = base_dir(&app_data_dir(&app_handle)?);
    super::save_snapshot(&base, &store_name, &contents)
}

#[tauri::command]
pub async fn store_safety_restore_snapshot(
    app_handle: AppHandle,
    store_name: String,
    store_file_name: String,
) -> Result<bool, String> {
    let data_dir = app_data_dir(&app_handle)?;
    let base = base_dir(&data_dir);
    let live = store_file_path(&data_dir, &store_file_name)?;
    super::restore_snapshot(&base, &store_name, &live)
}

#[tauri::command]
pub async fn store_safety_create_checkpoint(
    app_handle: AppHandle,
    store_name: String,
    contents: String,
    reason: String,
    app_version: String,
    schema_versions: BTreeMap<String, u32>,
) -> Result<CheckpointMetadata, String> {
    let base = base_dir(&app_data_dir(&app_handle)?);
    let metadata = super::create_checkpoint(
        &base,
        &store_name,
        &contents,
        &reason,
        &app_version,
        schema_versions,
    )?;
    info!(
        "[StoreSafety] Created checkpoint '{}' for store '{}' (reason '{}', {} bytes)",
        metadata.id, metadata.store_name, metadata.reason, metadata.content_size_bytes
    );
    Ok(metadata)
}

#[tauri::command]
pub async fn store_safety_list_checkpoints(
    app_handle: AppHandle,
    store_name: String,
) -> Result<Vec<CheckpointMetadata>, String> {
    let base = base_dir(&app_data_dir(&app_handle)?);
    super::list_checkpoints(&base, &store_name)
}

#[tauri::command]
pub async fn store_safety_read_checkpoint(
    app_handle: AppHandle,
    store_name: String,
    checkpoint_id: String,
) -> Result<String, String> {
    let base = base_dir(&app_data_dir(&app_handle)?);
    super::read_checkpoint(&base, &store_name, &checkpoint_id)
}

#[tauri::command]
pub async fn store_safety_quarantine_store(
    app_handle: AppHandle,
    store_name: String,
    store_file_name: String,
) -> Result<Option<String>, String> {
    let data_dir = app_data_dir(&app_handle)?;
    let base = base_dir(&data_dir);
    let live = store_file_path(&data_dir, &store_file_name)?;
    let quarantined = super::quarantine_store(&base, &store_name, &live)?;
    if let Some(path) = &quarantined {
        info!(
            "[StoreSafety] Quarantined store file of '{}' to '{}'",
            store_name, path
        );
    }
    Ok(quarantined)
}

#[tauri::command]
pub async fn store_safety_replace_store(
    app_handle: AppHandle,
    store_file_name: String,
    contents: String,
) -> Result<(), String> {
    let data_dir = app_data_dir(&app_handle)?;
    let live = store_file_path(&data_dir, &store_file_name)?;
    super::replace_store(&live, &contents)
}

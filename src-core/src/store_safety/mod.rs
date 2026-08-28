pub mod commands;

use std::{collections::BTreeMap, fs, path::Path, path::PathBuf, time::UNIX_EPOCH};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

pub const CHECKPOINT_FORMAT_VERSION: u32 = 1;

const MAX_NAME_LENGTH: usize = 128;

/// Checkpoint metadata, serialized camelCase for the frontend.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointMetadata {
    pub format_version: u32,
    pub id: String,
    pub store_name: String,
    pub app_version: String,
    pub reason: String,
    pub created_at: String,
    pub created_at_millis: i64,
    pub sequence: u64,
    pub schema_versions: BTreeMap<String, u32>,
    pub content_checksum: String,
    pub content_size_bytes: u64,
    pub content_file: String,
    #[serde(default)]
    pub content_file_exists: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotData {
    pub contents: String,
    pub modified_at_millis: u64,
}

pub fn base_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("StoreProtector")
}

/// Resolve a store file name inside the app data dir.
pub fn store_file_path(app_data_dir: &Path, store_file_name: &str) -> Result<PathBuf, String> {
    validate_name(store_file_name, true)?;
    Ok(app_data_dir.join(store_file_name))
}

fn snapshot_path(base: &Path, store_name: &str) -> PathBuf {
    base.join(format!("{store_name}.dat"))
}

fn checkpoint_dir(base: &Path, store_name: &str) -> PathBuf {
    base.join("checkpoints").join(store_name)
}

fn checkpoint_content_dir(base: &Path, store_name: &str) -> PathBuf {
    checkpoint_dir(base, store_name).join("content")
}

fn quarantine_dir(base: &Path, store_name: &str) -> PathBuf {
    base.join("quarantine").join(store_name)
}

fn validate_name(name: &str, allow_dot: bool) -> Result<(), String> {
    let valid = !name.is_empty()
        && name.len() <= MAX_NAME_LENGTH
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || (allow_dot && c == '.'));
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid name '{name}'"))
    }
}

fn validate_checkpoint_metadata(
    metadata: &CheckpointMetadata,
    store_name: &str,
    checkpoint_id: &str,
) -> Result<(), String> {
    if metadata.format_version != CHECKPOINT_FORMAT_VERSION {
        return Err(format!(
            "Checkpoint '{checkpoint_id}' uses unsupported metadata format {}",
            metadata.format_version
        ));
    }
    if metadata.store_name != store_name || metadata.id != checkpoint_id {
        return Err(format!(
            "Checkpoint '{checkpoint_id}' has mismatched metadata"
        ));
    }
    validate_name(&metadata.content_file, true)
        .map_err(|_| format!("Checkpoint '{checkpoint_id}' has an invalid content file"))
}

fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", md5::compute(bytes))
}

fn is_store_object(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .map(|value| value.is_object())
        .unwrap_or(false)
}

/// Write via a temp file, fsync, verify the written bytes, then rename over
/// the target, so a crash never leaves a half-written file under a final name.
fn write_file_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("'{}' has no parent directory", path.display()))?;
    fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create directory '{}': {e}", dir.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("'{}' has no file name", path.display()))?
        .to_string_lossy();
    let tmp_path = dir.join(format!("{file_name}.tmp-{}", uuid::Uuid::new_v4().simple()));
    let result = (|| -> Result<(), String> {
        fs::write(&tmp_path, contents)
            .map_err(|e| format!("Failed to write '{}': {e}", tmp_path.display()))?;
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&tmp_path)
            .map_err(|e| format!("Failed to open '{}': {e}", tmp_path.display()))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush '{}': {e}", tmp_path.display()))?;
        let written = fs::read(&tmp_path)
            .map_err(|e| format!("Failed to verify '{}': {e}", tmp_path.display()))?;
        if written != contents {
            return Err(format!(
                "Verified bytes of '{}' do not match the expected contents",
                tmp_path.display()
            ));
        }
        drop(file);
        rename_replacing(&tmp_path, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result
}

#[cfg(windows)]
fn rename_replacing(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let moved = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved != 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to move '{}' into place: {}",
            from.display(),
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(windows))]
fn rename_replacing(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|e| format!("Failed to move '{}' into place: {e}", from.display()))
}

/// Overwrite the rolling latest-known-good snapshot for a store.
pub fn save_snapshot(base: &Path, store_name: &str, contents: &str) -> Result<(), String> {
    validate_name(store_name, false)?;
    if !is_store_object(contents.as_bytes()) {
        return Err(format!(
            "Snapshot contents for store '{store_name}' are not a JSON object"
        ));
    }
    write_file_atomic(&snapshot_path(base, store_name), contents.as_bytes())
}

/// Read the rolling snapshot without touching the live store. None means no
/// viable snapshot exists.
pub fn read_snapshot(base: &Path, store_name: &str) -> Result<Option<SnapshotData>, String> {
    validate_name(store_name, false)?;
    let snapshot = snapshot_path(base, store_name);
    if !snapshot.is_file() {
        return Ok(None);
    }
    let metadata = fs::metadata(&snapshot)
        .map_err(|e| format!("Failed to read snapshot metadata for store '{store_name}': {e}"))?;
    let bytes = fs::read(&snapshot)
        .map_err(|e| format!("Failed to read snapshot of store '{store_name}': {e}"))?;
    if !is_store_object(&bytes) {
        return Err(format!(
            "Snapshot of store '{store_name}' is not a JSON object"
        ));
    }
    let contents = String::from_utf8(bytes)
        .map_err(|e| format!("Snapshot of store '{store_name}' is not valid UTF-8: {e}"))?;
    let modified_at_millis = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    Ok(Some(SnapshotData {
        contents,
        modified_at_millis,
    }))
}

/// Replace a corrupt live store file with the rolling snapshot. False means no
/// viable snapshot; the live file is left untouched in that case.
pub fn restore_snapshot(base: &Path, store_name: &str, live_path: &Path) -> Result<bool, String> {
    validate_name(store_name, false)?;
    let snapshot = snapshot_path(base, store_name);
    if !snapshot.is_file() {
        return Ok(false);
    }
    let bytes = fs::read(&snapshot)
        .map_err(|e| format!("Failed to read snapshot of store '{store_name}': {e}"))?;
    if !is_store_object(&bytes) {
        return Ok(false);
    }
    write_file_atomic(live_path, &bytes)?;
    Ok(true)
}

/// Create an immutable checkpoint; identical content returns the existing one.
pub fn create_checkpoint(
    base: &Path,
    store_name: &str,
    contents: &str,
    reason: &str,
    app_version: &str,
    schema_versions: BTreeMap<String, u32>,
) -> Result<CheckpointMetadata, String> {
    validate_name(store_name, false)?;
    if !is_store_object(contents.as_bytes()) {
        return Err(format!(
            "Checkpoint contents for store '{store_name}' are not a JSON object"
        ));
    }
    let checksum = checksum(contents.as_bytes());
    let existing = list_checkpoints(base, store_name)?;
    if let Some(metadata) = existing
        .iter()
        .find(|m| m.content_checksum == checksum && m.content_file_exists)
    {
        return Ok(metadata.clone());
    }
    let content_file = format!("{checksum}.dat");
    let content_path = checkpoint_content_dir(base, store_name).join(&content_file);
    if !content_path.is_file() {
        write_file_atomic(&content_path, contents.as_bytes())?;
    }
    let now = Utc::now();
    let sequence = existing.iter().map(|m| m.sequence).max().unwrap_or(0) + 1;
    let id = format!(
        "{}-{}-{}",
        now.timestamp_millis(),
        sequence,
        uuid::Uuid::new_v4().simple()
    );
    let metadata = CheckpointMetadata {
        format_version: CHECKPOINT_FORMAT_VERSION,
        id: id.clone(),
        store_name: store_name.to_string(),
        app_version: app_version.to_string(),
        reason: reason.to_string(),
        created_at: now.to_rfc3339_opts(SecondsFormat::Millis, true),
        created_at_millis: now.timestamp_millis(),
        sequence,
        schema_versions,
        content_checksum: checksum,
        content_size_bytes: contents.len() as u64,
        content_file,
        content_file_exists: true,
    };
    let metadata_path = checkpoint_dir(base, store_name).join(format!("{id}.json"));
    let metadata_bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize checkpoint metadata: {e}"))?;
    write_file_atomic(&metadata_path, &metadata_bytes)?;
    Ok(metadata)
}

/// List a store's checkpoints, newest first, skipping unreadable entries.
pub fn list_checkpoints(base: &Path, store_name: &str) -> Result<Vec<CheckpointMetadata>, String> {
    validate_name(store_name, false)?;
    let mut checkpoints: Vec<CheckpointMetadata> = Vec::new();
    let entries = match fs::read_dir(checkpoint_dir(base, store_name)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(checkpoints),
        Err(error) => {
            return Err(format!(
                "Failed to list checkpoints for store '{store_name}': {error}"
            ));
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let Ok(mut metadata) = serde_json::from_slice::<CheckpointMetadata>(&bytes) else {
            continue;
        };
        let Some(checkpoint_id) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if validate_checkpoint_metadata(&metadata, store_name, checkpoint_id).is_err() {
            continue;
        }
        metadata.content_file_exists = checkpoint_content_dir(base, store_name)
            .join(&metadata.content_file)
            .is_file();
        checkpoints.push(metadata);
    }
    checkpoints.sort_by_key(|m| std::cmp::Reverse((m.created_at_millis, m.sequence)));
    Ok(checkpoints)
}

/// Read checkpoint contents, verifying the stored checksum first.
pub fn read_checkpoint(
    base: &Path,
    store_name: &str,
    checkpoint_id: &str,
) -> Result<String, String> {
    validate_name(store_name, false)?;
    validate_name(checkpoint_id, false)?;
    let metadata_path = checkpoint_dir(base, store_name).join(format!("{checkpoint_id}.json"));
    let bytes = fs::read(&metadata_path)
        .map_err(|_| format!("Checkpoint '{checkpoint_id}' was not found"))?;
    let metadata: CheckpointMetadata = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Checkpoint '{checkpoint_id}' has unreadable metadata: {e}"))?;
    validate_checkpoint_metadata(&metadata, store_name, checkpoint_id)?;
    let content_path = checkpoint_content_dir(base, store_name).join(&metadata.content_file);
    let content = fs::read(&content_path)
        .map_err(|_| format!("Checkpoint '{checkpoint_id}' is missing its content"))?;
    if content.len() as u64 != metadata.content_size_bytes {
        return Err(format!(
            "Checkpoint '{checkpoint_id}' failed size verification"
        ));
    }
    if checksum(&content) != metadata.content_checksum {
        return Err(format!(
            "Checkpoint '{checkpoint_id}' failed checksum verification"
        ));
    }
    String::from_utf8(content)
        .map_err(|_| format!("Checkpoint '{checkpoint_id}' is not valid UTF-8"))
}

/// Move unusable live store bytes aside; None when there is no live file.
pub fn quarantine_store(
    base: &Path,
    store_name: &str,
    live_path: &Path,
) -> Result<Option<String>, String> {
    validate_name(store_name, false)?;
    if !live_path.is_file() {
        return Ok(None);
    }
    let dir = quarantine_dir(base, store_name);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create quarantine directory: {e}"))?;
    let id = format!(
        "{}-{}",
        Utc::now().timestamp_millis(),
        uuid::Uuid::new_v4().simple()
    );
    let destination = dir.join(format!("{id}.dat"));
    fs::rename(live_path, &destination)
        .map_err(|e| format!("Failed to quarantine store '{store_name}': {e}"))?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

/// Crash-safely replace a physical store file with new contents.
pub fn replace_store(live_path: &Path, contents: &str) -> Result<(), String> {
    if !is_store_object(contents.as_bytes()) {
        return Err(format!(
            "Replacement contents for '{}' are not a JSON object",
            live_path.display()
        ));
    }
    write_file_atomic(live_path, contents.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, TempDir) {
        (TempDir::new().unwrap(), TempDir::new().unwrap())
    }

    fn live_path(live_dir: &Path) -> PathBuf {
        live_dir.join("settings.dat")
    }

    fn dir_entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn checkpoint_metadata_is_stable() {
        let (base, _) = setup();
        let mut schema_versions = BTreeMap::new();
        schema_versions.insert("AUTOMATION_CONFIGS".to_string(), 8);
        let contents = r#"{"AUTOMATION_CONFIGS":{"version":8}}"#;
        let metadata = create_checkpoint(
            base.path(),
            "settings",
            contents,
            "pre-migration",
            "26.8.0-beta.6",
            schema_versions.clone(),
        )
        .unwrap();
        assert_eq!(metadata.format_version, CHECKPOINT_FORMAT_VERSION);
        assert_eq!(metadata.store_name, "settings");
        assert_eq!(metadata.app_version, "26.8.0-beta.6");
        assert_eq!(metadata.reason, "pre-migration");
        assert_eq!(metadata.schema_versions, schema_versions);
        assert_eq!(metadata.content_checksum, checksum(contents.as_bytes()));
        assert_eq!(metadata.content_size_bytes, contents.len() as u64);
        assert!(metadata.content_file_exists);
        assert!(chrono::DateTime::parse_from_rfc3339(&metadata.created_at).is_ok());
        let stored: CheckpointMetadata = serde_json::from_str(
            &fs::read_to_string(
                checkpoint_dir(base.path(), "settings").join(format!("{}.json", metadata.id)),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(stored.id, metadata.id);
        assert_eq!(stored.content_checksum, metadata.content_checksum);
        assert_eq!(stored.schema_versions, metadata.schema_versions);
        assert!(stored.content_file_exists);
    }

    #[test]
    fn checkpoints_deduplicate_by_content_hash() {
        let (base, _) = setup();
        let contents = r#"{"SLEEP_MODE":true}"#;
        let first = create_checkpoint(
            base.path(),
            "settings",
            contents,
            "pre-migration",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        let second = create_checkpoint(
            base.path(),
            "settings",
            contents,
            "manual",
            "2.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(
            dir_entries(&checkpoint_dir(base.path(), "settings")),
            vec![format!("{}.json", first.id), "content".to_string()]
        );
        assert_eq!(
            dir_entries(&checkpoint_content_dir(base.path(), "settings")).len(),
            1
        );
    }

    #[test]
    fn checkpoint_deduplication_recreates_missing_content() {
        let (base, _) = setup();
        let contents = r#"{"SLEEP_MODE":true}"#;
        let first = create_checkpoint(
            base.path(),
            "settings",
            contents,
            "pre-migration",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        fs::remove_file(checkpoint_content_dir(base.path(), "settings").join(first.content_file))
            .unwrap();
        let replacement = create_checkpoint(
            base.path(),
            "settings",
            contents,
            "store-recovery",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        assert_ne!(replacement.id, first.id);
        assert_eq!(
            read_checkpoint(base.path(), "settings", &replacement.id).unwrap(),
            contents
        );
    }

    #[test]
    fn checkpoints_list_newest_first() {
        let (base, _) = setup();
        let oldest = create_checkpoint(
            base.path(),
            "settings",
            r#"{"step":1}"#,
            "r1",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        let middle = create_checkpoint(
            base.path(),
            "settings",
            r#"{"step":2}"#,
            "r2",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        let newest = create_checkpoint(
            base.path(),
            "settings",
            r#"{"step":3}"#,
            "r3",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        let list = list_checkpoints(base.path(), "settings").unwrap();
        assert_eq!(
            list.iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
            vec![newest.id.clone(), middle.id.clone(), oldest.id.clone()]
        );
        assert!(newest.sequence > middle.sequence && middle.sequence > oldest.sequence);
        assert!(list.first().unwrap().content_file_exists);
        assert_eq!(
            serde_json::to_value(list.first().unwrap()).unwrap()["contentFileExists"],
            true
        );
    }

    #[test]
    fn snapshot_write_leaves_no_temp_files() {
        let (base, live_dir) = setup();
        save_snapshot(base.path(), "settings", r#"{"a":1}"#).unwrap();
        assert_eq!(dir_entries(base.path()), vec!["settings.dat".to_string()]);
        replace_store(&live_path(live_dir.path()), r#"{"b":2}"#).unwrap();
        assert_eq!(
            dir_entries(live_dir.path()),
            vec!["settings.dat".to_string()]
        );
        assert_eq!(
            fs::read_to_string(live_path(live_dir.path())).unwrap(),
            r#"{"b":2}"#
        );
    }

    #[test]
    fn snapshot_write_replaces_existing_snapshot() {
        let (base, _) = setup();
        save_snapshot(base.path(), "settings", r#"{"v":1}"#).unwrap();
        save_snapshot(base.path(), "settings", r#"{"v":2}"#).unwrap();
        assert_eq!(
            fs::read_to_string(snapshot_path(base.path(), "settings")).unwrap(),
            r#"{"v":2}"#
        );
    }

    #[test]
    fn replace_store_replaces_existing_file() {
        let (_, live_dir) = setup();
        let live = live_path(live_dir.path());
        fs::write(&live, r#"{"old":true}"#).unwrap();
        replace_store(&live, r#"{"new":true}"#).unwrap();
        assert_eq!(fs::read_to_string(&live).unwrap(), r#"{"new":true}"#);
    }

    #[test]
    fn snapshot_and_replacement_contents_must_be_json_objects() {
        let (base, live_dir) = setup();
        let live = live_path(live_dir.path());
        for contents in ["", "not json", r#"["array"]"#, "3"] {
            assert!(save_snapshot(base.path(), "settings", contents).is_err());
            assert!(replace_store(&live, contents).is_err());
        }
        assert!(!snapshot_path(base.path(), "settings").exists());
        assert!(!live.exists());
    }

    #[test]
    fn restore_snapshot_recovers_corrupt_live_store() {
        let (base, live_dir) = setup();
        let live = live_path(live_dir.path());
        for corrupt in ["", "{", r#"{"torn":"#] {
            fs::write(&live, corrupt).unwrap();
            save_snapshot(base.path(), "settings", r#"{"good":true}"#).unwrap();
            assert!(restore_snapshot(base.path(), "settings", &live).unwrap());
            assert_eq!(fs::read_to_string(&live).unwrap(), r#"{"good":true}"#);
        }
    }

    #[test]
    fn restore_snapshot_rejects_invalid_snapshot() {
        let (base, live_dir) = setup();
        let live = live_path(live_dir.path());
        fs::write(&live, r#"{"original":true}"#).unwrap();
        for snapshot_bytes in ["", "not json", r#"["array"]"#, r#"42"#] {
            fs::write(snapshot_path(base.path(), "settings"), snapshot_bytes).unwrap();
            assert!(!restore_snapshot(base.path(), "settings", &live).unwrap());
            assert_eq!(fs::read_to_string(&live).unwrap(), r#"{"original":true}"#);
        }
    }

    #[test]
    fn restore_snapshot_without_snapshot_returns_false() {
        let (base, live_dir) = setup();
        assert!(!restore_snapshot(base.path(), "settings", &live_path(live_dir.path())).unwrap());
    }

    #[test]
    fn read_snapshot_returns_contents_without_touching_live() {
        let (base, live_dir) = setup();
        let live = live_path(live_dir.path());
        fs::write(&live, r#"{"original":true}"#).unwrap();
        save_snapshot(base.path(), "settings", r#"{"good":true}"#).unwrap();
        assert_eq!(
            read_snapshot(base.path(), "settings")
                .unwrap()
                .unwrap()
                .contents,
            r#"{"good":true}"#
        );
        assert_eq!(fs::read_to_string(&live).unwrap(), r#"{"original":true}"#);
    }

    #[test]
    fn read_snapshot_returns_none_for_missing_snapshot_and_rejects_invalid_snapshot() {
        let (base, _) = setup();
        assert_eq!(read_snapshot(base.path(), "settings").unwrap(), None);
        for snapshot_bytes in ["", "not json", r#"["array"]"#, r#"42"#] {
            fs::write(snapshot_path(base.path(), "settings"), snapshot_bytes).unwrap();
            assert!(read_snapshot(base.path(), "settings").is_err());
        }
        assert!(read_snapshot(base.path(), "../evil").is_err());
    }

    #[test]
    fn read_checkpoint_detects_corruption() {
        let (base, _) = setup();
        let contents = r#"{"data":1}"#;
        let metadata = create_checkpoint(
            base.path(),
            "settings",
            contents,
            "pre-migration",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            read_checkpoint(base.path(), "settings", &metadata.id).unwrap(),
            contents
        );
        let content_path =
            checkpoint_content_dir(base.path(), "settings").join(&metadata.content_file);
        fs::write(&content_path, r#"{"data":2}"#).unwrap();
        assert!(read_checkpoint(base.path(), "settings", &metadata.id)
            .unwrap_err()
            .contains("checksum"));
        fs::write(&content_path, r#"{"data":"too long"}"#).unwrap();
        assert!(read_checkpoint(base.path(), "settings", &metadata.id)
            .unwrap_err()
            .contains("size"));
        fs::remove_file(&content_path).unwrap();
        assert!(read_checkpoint(base.path(), "settings", &metadata.id)
            .unwrap_err()
            .contains("missing"));
        let list = list_checkpoints(base.path(), "settings").unwrap();
        assert_eq!(list.len(), 1);
        assert!(!list[0].content_file_exists);
    }

    #[test]
    fn checkpoint_metadata_must_match_its_file_name() {
        let (base, _) = setup();
        let metadata = create_checkpoint(
            base.path(),
            "settings",
            r#"{"data":1}"#,
            "pre-migration",
            "1.0.0",
            BTreeMap::new(),
        )
        .unwrap();
        let metadata_path =
            checkpoint_dir(base.path(), "settings").join(format!("{}.json", metadata.id));
        let mut stored: CheckpointMetadata =
            serde_json::from_str(&fs::read_to_string(&metadata_path).unwrap()).unwrap();
        stored.id = "different".to_string();
        fs::write(&metadata_path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(list_checkpoints(base.path(), "settings")
            .unwrap()
            .is_empty());
        assert!(read_checkpoint(base.path(), "settings", &metadata.id)
            .unwrap_err()
            .contains("mismatched"));
    }

    #[test]
    fn quarantine_store_preserves_bytes() {
        let (base, live_dir) = setup();
        let live = live_path(live_dir.path());
        assert_eq!(
            quarantine_store(base.path(), "settings", &live).unwrap(),
            None
        );
        fs::write(&live, r#"{"broken":"bytes"}"#).unwrap();
        let quarantined = quarantine_store(base.path(), "settings", &live)
            .unwrap()
            .expect("live file should be quarantined");
        assert!(!live.exists());
        assert_eq!(
            fs::read_to_string(&quarantined).unwrap(),
            r#"{"broken":"bytes"}"#
        );
        assert!(quarantined.contains("quarantine"));
        assert_eq!(
            quarantine_store(base.path(), "settings", &live).unwrap(),
            None
        );
    }

    #[test]
    fn names_are_validated() {
        let (base, live_dir) = setup();
        for name in ["", "..", "../evil", "a/b", "a\\b", ".hidden", "sp ace"] {
            assert!(
                validate_name(name, false).is_err(),
                "{name} should be rejected"
            );
        }
        assert!(save_snapshot(base.path(), "../evil", "{}").is_err());
        assert!(create_checkpoint(base.path(), "a/b", "{}", "r", "1", BTreeMap::new()).is_err());
        assert!(restore_snapshot(base.path(), "..", &live_path(live_dir.path())).is_err());
        assert!(validate_name("settings", false).is_ok());
        assert!(validate_name("event_log-1", false).is_ok());
        assert!(validate_name("settings.dat", true).is_ok());
        assert!(validate_name("..", true).is_err());
    }

    #[test]
    fn checkpoint_contents_must_be_a_json_object() {
        let (base, _) = setup();
        for contents in ["", "not json", r#"[1,2]"#, r#"3"#] {
            assert!(create_checkpoint(
                base.path(),
                "settings",
                contents,
                "pre-migration",
                "1.0.0",
                BTreeMap::new()
            )
            .is_err());
        }
    }
}

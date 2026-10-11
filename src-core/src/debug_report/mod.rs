pub mod commands;
mod system;

use std::{
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime},
};

use regex::Regex;
use serde_json::Value;
use tokio::sync::Mutex;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

/// The KV value limit of the upload endpoint.
pub const MAX_REPORT_BYTES: usize = 25 * 1024 * 1024;
pub const UPLOAD_URL: &str = "https://api.raphii.co/oyasumivr/debug-reports";
const LOG_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const REMOVED: &str = "<removed>";

/// The last built report, so a retry or a save sends the same zip.
static PENDING_REPORT: LazyLock<Mutex<Option<Vec<u8>>>> = LazyLock::new(|| Mutex::new(None));

static TOKEN_PARAM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(\w*(?:token|password|secret|cookie))=[^&\s#'\x22]+").unwrap()
});

pub struct ReportFile {
    pub name: String,
    pub contents: Vec<u8>,
}

impl ReportFile {
    fn text(name: impl Into<String>, contents: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            contents: contents.into().into_bytes(),
        }
    }
}

/// Replaces the user's name in profile paths, and the values of token-like URL parameters.
/// `profile` comes from `profile_path_pattern`.
pub fn scrub_text(text: &str, profile: Option<&Regex>) -> String {
    let text = TOKEN_PARAM.replace_all(text, format!("$1={REMOVED}"));
    match profile {
        Some(profile) => profile.replace_all(&text, "${1}<user>${2}").into_owned(),
        None => text.into_owned(),
    }
}

/// Matches a folder from `names` directly under `Users` or a folder from `parents`.
/// Returns None when `names` holds no name.
pub fn profile_path_pattern(names: &[String], parents: &[String]) -> Option<Regex> {
    let alternatives = |items: &[String]| {
        let mut items: Vec<&String> = items.iter().filter(|item| !item.is_empty()).collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.len()));
        items
            .into_iter()
            .map(|item| regex::escape(item))
            .collect::<Vec<_>>()
            .join("|")
    };
    let names = alternatives(names);
    if names.is_empty() {
        return None;
    }
    let parents = alternatives(&[&["users".to_string()], parents].concat());
    let pattern = format!(r"(?i)((?:{parents})(?:\\\\|\\|/))(?:{names})(\W|$)");
    Some(Regex::new(&pattern).expect("escaped names form a valid pattern"))
}

/// The profile path pattern for the current user: the account name, and the profile folder in its
/// long and 8.3 forms, because a renamed account keeps its old folder and some `TEMP` paths are 8.3.
fn current_user_profile_pattern() -> Option<Regex> {
    let profile = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let short_profile = profile.as_deref().and_then(short_path);
    let profiles: Vec<PathBuf> = profile.into_iter().chain(short_profile).collect();
    user_profile_pattern(std::env::var("USERNAME").ok(), &profiles)
}

/// The profile path pattern for `username` and the folder name of each path in `profiles`.
fn user_profile_pattern(username: Option<String>, profiles: &[PathBuf]) -> Option<Regex> {
    let name = |path: &Path| path.file_name().map(|n| n.to_string_lossy().into_owned());
    // a profile directly under a drive root has the drive, such as `D:`, as its parent
    let parent = |path: &Path| {
        let parent = path.parent()?;
        Some(name(parent).unwrap_or_else(|| {
            let drive = parent.to_string_lossy();
            drive.trim_end_matches(['\\', '/']).to_string()
        }))
    };
    let names: Vec<String> = username
        .into_iter()
        .chain(profiles.iter().filter_map(|path| name(path)))
        .collect();
    let parents: Vec<String> = profiles.iter().filter_map(|path| parent(path)).collect();
    profile_path_pattern(&names, &parents)
}

fn short_path(path: &Path) -> Option<PathBuf> {
    use std::{
        ffi::OsString,
        os::windows::ffi::{OsStrExt, OsStringExt},
    };
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let mut buffer = [0u16; 1024];
    let len = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) }
        as usize;
    (len > 0 && len < buffer.len()).then(|| OsString::from_wide(&buffer[..len]).into())
}

fn is_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["password", "token", "cookie", "secret", "credentials"]
        .iter()
        .any(|word| key.contains(word))
}

fn scrub_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                let is_set = !(value.is_null() || value.as_str() == Some(""));
                if is_secret_key(key) && is_set {
                    *value = Value::String(REMOVED.into());
                } else {
                    scrub_value(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(scrub_value),
        _ => {}
    }
}

/// Replaces every non-empty value under a credential-like key in a settings store.
pub fn scrub_settings(json: &str, profile: Option<&Regex>) -> Result<String, String> {
    let mut value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    scrub_value(&mut value);
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    Ok(scrub_text(&text, profile))
}

pub fn build_zip(files: &[ReportFile]) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for file in files {
        zip.start_file(file.name.as_str(), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&file.contents).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

fn read_text_lossy(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// The log files changed in the past 7 days.
fn collect_logs(dirs: &[PathBuf], profile: Option<&Regex>) -> Vec<ReportFile> {
    let now = SystemTime::now();
    dirs.iter()
        .filter_map(|dir| fs::read_dir(dir).ok())
        .flatten()
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
        .filter(|entry| {
            let modified = entry.metadata().and_then(|m| m.modified());
            modified.is_ok_and(|m| now.duration_since(m).unwrap_or_default() <= LOG_MAX_AGE)
        })
        .map(|entry| entry.path())
        .filter_map(|path| {
            let name = path.file_name()?.to_string_lossy().into_owned();
            let text = read_text_lossy(&path)?;
            Some(ReportFile::text(
                format!("logs/{name}"),
                scrub_text(&text, profile),
            ))
        })
        .collect()
}

/// The memory-watch incident files, without the process dump.
fn collect_memory_watch(dir: &Path, profile: Option<&Regex>) -> Vec<ReportFile> {
    let mut files = Vec::new();
    if let Some(text) = read_text_lossy(&dir.join("watch-error.txt")) {
        files.push(ReportFile::text(
            "memory-watch/watch-error.txt",
            scrub_text(&text, profile),
        ));
    }
    let Ok(entries) = fs::read_dir(dir.join("incident")) else {
        return files;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("process.dmp") {
            continue;
        }
        if let Some(text) = read_text_lossy(&entry.path()) {
            files.push(ReportFile::text(
                format!("memory-watch/incident/{name}"),
                scrub_text(&text, profile),
            ));
        }
    }
    files
}

/// Names, sizes and dates of the store checkpoints and quarantined stores, without their contents.
fn list_store_protector(base: &Path) -> String {
    fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                walk(&path, base, out);
                continue;
            }
            let modified = metadata
                .modified()
                .map(|m| chrono::DateTime::<chrono::Utc>::from(m).to_rfc3339())
                .unwrap_or_default();
            let relative = path.strip_prefix(base).unwrap_or(&path).display();
            out.push(format!("{relative}\t{}\t{modified}", metadata.len()));
        }
    }
    let mut lines = Vec::new();
    walk(base, base, &mut lines);
    lines.sort();
    lines.join("\n")
}

fn steamvr_settings_path() -> Option<PathBuf> {
    let vrpath = dirs::data_local_dir()?
        .join("openvr")
        .join("openvrpaths.vrpath");
    let paths: Value = serde_json::from_str(&fs::read_to_string(vrpath).ok()?).ok()?;
    let config_dir = paths.get("config")?.get(0)?.as_str()?;
    Some(PathBuf::from(config_dir).join("steamvr.vrsettings"))
}

pub struct ReportSources {
    pub app_data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub ui_state: Value,
}

/// Collects everything for a debug report and stores the zip as the pending report.
pub async fn create(sources: ReportSources) -> Result<usize, String> {
    // a failed build must not leave an older report for a save or retry to send
    *PENDING_REPORT.lock().await = None;

    let profile = current_user_profile_pattern();
    let profile = profile.as_ref();

    let mut files = Vec::new();

    // report.json with the system, SteamVR and app state
    let mut report = system::collect().await;
    report["ui"] = sources.ui_state;
    let report = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    files.push(ReportFile::text(
        "report.json",
        scrub_text(&report, profile),
    ));

    // settings with credentials removed, and the event log
    if let Some(json) = read_text_lossy(&sources.app_data_dir.join("settings.dat")) {
        let scrubbed = scrub_settings(&json, profile)
            .unwrap_or_else(|e| format!("settings.dat could not be read as JSON: {e}"));
        files.push(ReportFile::text("settings.json", scrubbed));
    }
    if let Some(json) = read_text_lossy(&sources.app_data_dir.join("event_log.dat")) {
        files.push(ReportFile::text(
            "event_log.json",
            scrub_text(&json, profile),
        ));
    }
    files.push(ReportFile::text(
        "store-protector.txt",
        list_store_protector(&sources.app_data_dir.join("StoreProtector")),
    ));

    // files from outside the app data directory
    if let Some(text) = steamvr_settings_path().and_then(|p| read_text_lossy(&p)) {
        files.push(ReportFile::text(
            "steamvr.vrsettings",
            scrub_text(&text, profile),
        ));
    }
    if let Some(text) = std::env::current_exe()
        .ok()
        .and_then(|exe| read_text_lossy(&exe.with_file_name("panic.log")))
    {
        files.push(ReportFile::text("panic.log", scrub_text(&text, profile)));
    }
    if let Some(dir) = dirs::data_local_dir() {
        files.extend(collect_memory_watch(
            &dir.join("OyasumiVR").join("memory-watch"),
            profile,
        ));
    }

    // logs
    let mut log_dirs = vec![sources.log_dir];
    log_dirs.extend(crate::elevated_sidecar::launcher::privileged_dir());
    files.extend(collect_logs(&log_dirs, profile));

    let zip = tokio::task::spawn_blocking(move || build_zip(&files))
        .await
        .map_err(|e| e.to_string())??;
    let size = zip.len();
    *PENDING_REPORT.lock().await = Some(zip);
    Ok(size)
}

pub async fn pending_report() -> Option<Vec<u8>> {
    PENDING_REPORT.lock().await.clone()
}

pub async fn discard() {
    if PENDING_REPORT.lock().await.take().is_some() {
        log::info!("[Core] Discarded the pending debug report");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn pattern(names: &[&str], parents: &[&str]) -> Option<Regex> {
        let strings = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        profile_path_pattern(&strings(names), &strings(parents))
    }

    #[test]
    fn scrub_text_replaces_the_username_in_profile_paths() {
        let text = r#"C:\Users\Raphii\AppData and C:\\Users\\raphii\\x and C:/Users/Raphii/y, Raphii says hi"#;
        assert_eq!(
            scrub_text(text, pattern(&["Raphii"], &[]).as_ref()),
            r#"C:\Users\<user>\AppData and C:\\Users\\<user>\\x and C:/Users/<user>/y, Raphii says hi"#
        );
    }

    #[test]
    fn scrub_text_keeps_a_longer_name_that_starts_with_the_username() {
        assert_eq!(
            scrub_text(r"C:\Users\Raphiiko", pattern(&["Raphii"], &[]).as_ref()),
            r"C:\Users\Raphiiko"
        );
    }

    #[test]
    fn scrub_text_replaces_a_username_that_ends_in_punctuation() {
        let text = r#"C:\Users\raph-\AppData "C:\\Users\\raph-" C:\Users\Bob!"#;
        assert_eq!(
            scrub_text(text, pattern(&["raph-", "Bob!"], &[]).as_ref()),
            r#"C:\Users\<user>\AppData "C:\\Users\\<user>" C:\Users\<user>"#
        );
    }

    #[test]
    fn scrub_text_replaces_every_name_of_the_profile_folder() {
        let text = r"C:\Users\RAPHAE~1\AppData\Local\Temp D:\Profiles\Raphael\x C:\Users\NewName\y";
        assert_eq!(
            scrub_text(
                text,
                pattern(&["NewName", "Raphael", "RAPHAE~1"], &["Profiles"]).as_ref()
            ),
            r"C:\Users\<user>\AppData\Local\Temp D:\Profiles\<user>\x C:\Users\<user>\y"
        );
    }

    #[test]
    fn user_profile_pattern_covers_renamed_short_and_drive_root_profiles() {
        let profiles = [
            PathBuf::from(r"C:\Users\Raphael"),
            PathBuf::from(r"C:\Users\RAPHAE~1"),
            PathBuf::from(r"D:\Old"),
        ];
        let profile = user_profile_pattern(Some("NewName".into()), &profiles);
        let text = r#"C:\Users\NewName\a C:\Users\RAPHAE~1\b "D:\\Old\\c" d:/old/d D:\Older\e"#;
        assert_eq!(
            scrub_text(text, profile.as_ref()),
            r#"C:\Users\<user>\a C:\Users\<user>\b "D:\\<user>\\c" d:/<user>/d D:\Older\e"#
        );
    }

    #[test]
    fn profile_path_pattern_needs_a_name() {
        assert!(pattern(&[""], &["Profiles"]).is_none());
    }

    #[test]
    fn scrub_text_removes_token_parameters() {
        let text = "oyasumivr://x#access_token=abc123&state=s1 wss://pipeline?authToken=xyz&x=1 \
                    ?accessToken=a&clientSecret=b&tokens=3";
        assert_eq!(
            scrub_text(text, None),
            "oyasumivr://x#access_token=<removed>&state=s1 wss://pipeline?authToken=<removed>&x=1 \
             ?accessToken=<removed>&clientSecret=<removed>&tokens=3"
        );
    }

    #[test]
    fn scrub_settings_removes_credentials_and_keeps_the_rest() {
        let json = r#"{
            "VRCHAT_API": {"profiles": [{"authCookie": "a", "twoFactorCookie": null,
                "rememberedCredentials": {"username": "u", "password": "p"}, "protectedSecret": "s",
                "userId": "usr_1"}]},
            "APP_SETTINGS": {"mqttPassword": "", "mqttProtectedPassword": "x", "mqttHost": "10.0.0.2",
                "oscServerEnabled": true},
            "PULSOID_API": {"accessToken": "t", "expiresAt": 5}
        }"#;
        let scrubbed: Value = serde_json::from_str(&scrub_settings(json, None).unwrap()).unwrap();
        let profile = &scrubbed["VRCHAT_API"]["profiles"][0];
        assert_eq!(profile["authCookie"], REMOVED);
        assert_eq!(profile["twoFactorCookie"], Value::Null);
        assert_eq!(profile["rememberedCredentials"], REMOVED);
        assert_eq!(profile["protectedSecret"], REMOVED);
        assert_eq!(profile["userId"], "usr_1");
        let app = &scrubbed["APP_SETTINGS"];
        assert_eq!(app["mqttPassword"], "");
        assert_eq!(app["mqttProtectedPassword"], REMOVED);
        assert_eq!(app["mqttHost"], "10.0.0.2");
        assert_eq!(app["oscServerEnabled"], true);
        assert_eq!(scrubbed["PULSOID_API"]["accessToken"], REMOVED);
        assert_eq!(scrubbed["PULSOID_API"]["expiresAt"], 5);
    }

    #[test]
    fn build_zip_writes_every_file() {
        let files = vec![
            ReportFile::text("report.json", "{}"),
            ReportFile::text("logs/OyasumiVR.log", "line"),
        ];
        let mut archive = zip::ZipArchive::new(Cursor::new(build_zip(&files).unwrap())).unwrap();
        let mut log = String::new();
        archive
            .by_name("logs/OyasumiVR.log")
            .unwrap()
            .read_to_string(&mut log)
            .unwrap();
        assert_eq!(archive.len(), 2);
        assert_eq!(log, "line");
    }
}

use regex::Regex;
use sentry::{
    protocol::{Addr, DebugImage, DebugMeta, Event, SymbolicDebugImage},
    types::{CodeId, DebugId},
    ClientInitGuard, ClientOptions, Envelope, Transport,
};
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Condvar, LazyLock, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const DSN: &str = "https://a08e4e04b7a24cafb5eb6c4ff701e52e@sentry.raphii.co/1";

#[derive(Clone, Deserialize, Serialize)]
struct BudgetState {
    day: u64,
    first_events: u32,
    recurrence_events: u32,
    issues: BTreeMap<String, u32>,
}

pub struct EventBudget {
    path: PathBuf,
    first_event_cap: u32,
    recurrence_cap: u32,
    issue_cap: u32,
    recurrence_sample_rate: f32,
    state: Mutex<BudgetState>,
}

pub struct EventBudgetConfig {
    pub first_event_cap: u32,
    pub recurrence_cap: u32,
    pub issue_cap: u32,
    pub recurrence_sample_rate: f32,
}

impl EventBudget {
    pub fn new(path: PathBuf, config: EventBudgetConfig) -> Self {
        let day = current_day();
        let state = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .filter(|state: &BudgetState| state.day == day)
            .unwrap_or(BudgetState {
                day,
                first_events: 0,
                recurrence_events: 0,
                issues: BTreeMap::new(),
            });
        Self {
            path,
            first_event_cap: config.first_event_cap,
            recurrence_cap: config.recurrence_cap,
            issue_cap: config.issue_cap,
            recurrence_sample_rate: config.recurrence_sample_rate,
            state: Mutex::new(state),
        }
    }

    pub fn allow(&self, issue: &str) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        let day = current_day();
        if state.day != day {
            *state = BudgetState {
                day,
                first_events: 0,
                recurrence_events: 0,
                issues: BTreeMap::new(),
            };
        }
        let previous = state.clone();
        let occurrences = state.issues.get(issue).copied().unwrap_or_default();
        if occurrences == 0 {
            if state.first_events >= self.first_event_cap {
                return false;
            }
            state.first_events += 1;
        } else if occurrences >= self.issue_cap
            || state.recurrence_events >= self.recurrence_cap
            || !sample(self.recurrence_sample_rate)
        {
            return false;
        } else {
            state.recurrence_events += 1;
        }
        *state.issues.entry(issue.to_owned()).or_default() += 1;
        if persist(&self.path, &state).is_err() {
            *state = previous;
            return false;
        }
        true
    }
}

pub fn init(
    component: &'static str,
    version: &'static str,
    budget: Arc<EventBudget>,
    enabled: Arc<AtomicBool>,
) -> ClientInitGuard {
    let issue_budget = budget.clone();
    let transport_enabled = enabled.clone();
    let mut options = ClientOptions::new()
        .release(version)
        .send_default_pii(false)
        .max_breadcrumbs(0)
        .shutdown_timeout(Duration::from_secs(2))
        .before_breadcrumb(|_| None)
        .before_send(move |mut event| {
            if !enabled.load(Ordering::Relaxed) {
                return None;
            }
            sanitize_event(&mut event, component, version);
            issue_budget.allow(&issue_key(&event)).then_some(event)
        })
        .transport(TinyTransportFactory {
            enabled: transport_enabled,
        });
    options.dsn = DSN.parse().ok();
    options.auto_session_tracking = false;
    let guard = sentry::init(options);
    let next_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(location) = info.location() {
            sentry::with_scope(
                |scope| {
                    scope.set_tag(
                        "panic_location",
                        format!("{}:{}", safe_filename(location.file()), location.line()),
                    );
                },
                || next_panic_hook(info),
            );
        } else {
            next_panic_hook(info);
        }
    }));
    sentry::configure_scope(|scope| {
        scope.set_tag("component", component);
        scope.set_tag("platform", "windows");
        scope.set_tag("app_version", version);
    });
    guard
}

fn current_day() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400
}

fn sample(rate: f32) -> bool {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    if rate >= 1.0 {
        return true;
    }
    if rate <= 0.0 {
        return false;
    }
    let interval = (1.0 / rate as f64).round().max(1.0) as u64;
    COUNTER
        .fetch_add(1, Ordering::Relaxed)
        .is_multiple_of(interval)
}

fn persist(path: &Path, state: &BudgetState) -> Result<(), ()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };

    let parent = path.parent().ok_or(())?;
    fs::create_dir_all(parent).map_err(|_| ())?;
    let data = serde_json::to_vec(state).map_err(|_| ())?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, data).map_err(|_| ())?;
    let temporary_wide: Vec<_> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let path_wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(temporary_wide.as_ptr()),
            PCWSTR(path_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|_| ())
    }
}

fn issue_key(event: &Event<'_>) -> String {
    if let Some(exception) = event.exception.values.first() {
        let frame = exception
            .stacktrace
            .as_ref()
            .and_then(|stack| stack.frames.last());
        return format!(
            "{}:{}:{}:{}",
            exception.ty,
            exception.value.as_deref().unwrap_or_default(),
            frame
                .and_then(|frame| frame.module.as_deref())
                .unwrap_or_default(),
            frame
                .and_then(|frame| frame.function.as_deref())
                .unwrap_or_default()
        );
    }
    event
        .message
        .as_deref()
        .unwrap_or("unknown")
        .chars()
        .take(160)
        .collect()
}

fn sanitize_event(event: &mut Event<'static>, component: &str, version: &str) {
    let strict = component == "elevated";
    let panic_location = event.tags.get("panic_location").and_then(|value| {
        let (filename, line) = value.rsplit_once(':')?;
        line.parse::<u32>().ok()?;
        Some(format!("{}:{line}", safe_filename(filename)))
    });
    event.user = None;
    event.request = None;
    event.server_name = None;
    event.culprit = None;
    event.transaction = None;
    event.logentry = None;
    event.logger = None;
    event.stacktrace = None;
    event.template = None;
    event.threads.values.clear();
    event.debug_meta = Cow::Owned(DebugMeta {
        sdk_info: None,
        images: OWN_IMAGE.iter().cloned().collect(),
    });
    event.breadcrumbs.values.clear();
    event.extra.clear();
    event.modules.clear();
    event
        .contexts
        .retain(|name, _| name == "os" || name == "runtime");
    event.tags.clear();
    event.tags.insert("component".into(), component.into());
    event.tags.insert("platform".into(), "windows".into());
    event.tags.insert("app_version".into(), version.into());
    if let Some(panic_location) = panic_location {
        event.tags.insert("panic_location".into(), panic_location);
    }
    if let Some(message) = event.message.as_mut() {
        *message = sanitize_text(message, strict);
    }
    for exception in &mut event.exception.values {
        exception.module = None;
        exception.raw_stacktrace = None;
        exception.value = exception
            .value
            .as_deref()
            .map(|value| sanitize_text(value, strict));
        if let Some(mechanism) = exception.mechanism.as_mut() {
            mechanism.description = None;
            mechanism.help_link = None;
            mechanism.data.clear();
            mechanism.meta = Default::default();
        }
        if let Some(stacktrace) = exception.stacktrace.as_mut() {
            for frame in &mut stacktrace.frames {
                sanitize_frame(frame);
            }
        }
    }
}

/// The running exe's load address and PDB identity, so a stack can be resolved against the
/// symbol store. Carries file names only, never paths.
static OWN_IMAGE: LazyLock<Option<DebugImage>> = LazyLock::new(|| {
    unsafe extern "C" {
        // the MSVC linker places this symbol at the start of the module that contains it
        static __ImageBase: u8;
    }
    unsafe { read_pe_image(&raw const __ImageBase) }
});

/// Reads the PE headers of a module mapped at `base`.
///
/// # Safety
/// `base` must point to a PE image the loader mapped into this process.
unsafe fn read_pe_image(base: *const u8) -> Option<DebugImage> {
    let read_u16 = |offset: usize| unsafe { base.add(offset).cast::<u16>().read_unaligned() };
    let read_u32 = |offset: usize| unsafe { base.add(offset).cast::<u32>().read_unaligned() };

    // locate the optional header
    if read_u16(0) != 0x5A4D {
        return None;
    }
    let nt_headers = read_u32(0x3C) as usize;
    if read_u32(nt_headers) != 0x4550 || read_u16(nt_headers + 24) != 0x20B {
        return None;
    }
    let timestamp = read_u32(nt_headers + 8);
    let optional_header = nt_headers + 24;
    let image_size = read_u32(optional_header + 56);
    if read_u32(optional_header + 108) <= 6 {
        return None;
    }

    // find the CodeView record in the debug directory
    let debug_directory = read_u32(optional_header + 112 + 6 * 8) as usize;
    let debug_directory_size = read_u32(optional_header + 112 + 6 * 8 + 4) as usize;
    let codeview = (0..debug_directory_size / 28)
        .map(|index| debug_directory + index * 28)
        .find(|&entry| read_u32(entry + 12) == 2)
        .map(|entry| read_u32(entry + 20) as usize)
        .filter(|&record| record != 0 && read_u32(record) == 0x5344_5352)?;

    // read the PDB GUID, age and file name
    let guid = unsafe { std::slice::from_raw_parts(base.add(codeview + 4), 16) };
    let age = read_u32(codeview + 20);
    let pdb_path = unsafe { std::ffi::CStr::from_ptr(base.add(codeview + 24).cast()) };
    let exe_path = std::env::current_exe().ok()?;
    Some(DebugImage::Symbolic(SymbolicDebugImage {
        name: safe_filename(&exe_path.to_string_lossy()),
        arch: Some("x86_64".into()),
        image_addr: Addr::from(base),
        image_size: image_size.into(),
        image_vmaddr: Addr(0),
        id: DebugId::from_guid_age(guid, age).ok()?,
        code_id: Some(CodeId::new(format!("{timestamp:08X}{image_size:x}"))),
        debug_file: Some(safe_filename(&pdb_path.to_string_lossy())),
    }))
}

fn sanitize_frame(frame: &mut sentry::protocol::Frame) {
    frame.abs_path = None;
    frame.package = None;
    frame.vars.clear();
    frame.pre_context.clear();
    frame.context_line = None;
    frame.post_context.clear();
    if let Some(filename) = frame.filename.as_mut() {
        *filename = safe_filename(filename);
    }
}

/// Redacts one value with the same rules `before_send` applies to event text.
pub fn sanitize_value(value: &str) -> String {
    sanitize_text(value, false)
}

fn sanitize_text(value: &str, strict: bool) -> String {
    if strict {
        return "elevated error".to_owned();
    }
    static SENSITIVE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
        [
            r"(?i)\bauthorization\s*[:=]\s*\S+(?:\s+\S+)?",
            r"(?i)\bbearer\s+\S+",
            r"(?i)(token|password|secret|api[_-]?key)\s*[:=]?\s*\S+",
            r"(?i)\b(user(name)?|display\s*name|account\s*id)\s*[:=]\s*\S+",
            r#"(?i)"(?:[a-z]:[\\/]|\\\\)[^"\r\n]+""#,
            r"(?i)\b[a-z]:[\\/][^\r\n]+",
            r"\\\\[^\s\r\n]+",
            r"(?i)file:///\S+",
            r"(?i)https?://\S+",
            r"(?i)\b(device\s*)?serial(\s*number)?\s*[:=]\s*\S+",
            r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b",
            r"(?i)\b(?:usr|auth|file|avtr|wrld|grp)_[a-z0-9-]+\b",
            r"\b[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}\b",
            r"\b\d{8,}\b",
        ]
        .into_iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect()
    });
    let mut result = value.to_owned();
    for pattern in SENSITIVE.iter() {
        result = pattern.replace_all(&result, "[redacted]").into_owned();
    }
    result.chars().take(512).collect()
}

fn safe_filename(value: &str) -> String {
    value
        .replace('\\', "/")
        .split('/')
        .next_back()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_owned()
}

#[derive(Clone)]
struct TinyTransportFactory {
    enabled: Arc<AtomicBool>,
}

impl sentry::TransportFactory for TinyTransportFactory {
    fn create_transport(&self, options: &ClientOptions) -> Arc<dyn Transport> {
        Arc::new(TinyTransport::new(options, self.enabled.clone()))
    }
}

struct TinyTransport {
    sender: mpsc::SyncSender<Envelope>,
    pending: Arc<(Mutex<usize>, Condvar)>,
    enabled: Arc<AtomicBool>,
}

impl TinyTransport {
    fn new(options: &ClientOptions, enabled: Arc<AtomicBool>) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Envelope>(2);
        let pending = Arc::new((Mutex::new(0), Condvar::new()));
        let Some(dsn) = options.dsn.as_ref() else {
            return Self {
                sender,
                pending,
                enabled,
            };
        };
        let url = dsn.envelope_api_url().to_string();
        let auth = dsn.to_auth(Some(&options.user_agent)).to_string();
        let worker_pending = pending.clone();
        let worker_enabled = enabled.clone();
        let _ = std::thread::Builder::new().spawn(move || {
            crate::install_tls_provider();
            let Ok(client) = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(1))
                .timeout(Duration::from_millis(1500))
                .build()
            else {
                return;
            };
            while let Ok(envelope) = receiver.recv() {
                if !worker_enabled.load(Ordering::Relaxed) {
                    finish_pending(&worker_pending);
                    continue;
                }
                let mut body = Vec::new();
                if envelope.to_writer(&mut body).is_ok() && worker_enabled.load(Ordering::Relaxed) {
                    let _ = client
                        .post(&url)
                        .header("X-Sentry-Auth", &auth)
                        .header("Content-Type", "application/x-sentry-envelope")
                        .body(body)
                        .send();
                }
                finish_pending(&worker_pending);
            }
        });
        Self {
            sender,
            pending,
            enabled,
        }
    }
}

impl Transport for TinyTransport {
    fn send_envelope(&self, envelope: Envelope) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let Ok(mut pending) = self.pending.0.lock() else {
            return;
        };
        if *pending >= 2 {
            return;
        }
        *pending += 1;
        drop(pending);
        if self.sender.try_send(envelope).is_err() {
            finish_pending(&self.pending);
        }
    }

    fn flush(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let Ok(mut pending) = self.pending.0.lock() else {
            return false;
        };
        while *pending != 0 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let Ok((next, result)) = self.pending.1.wait_timeout(pending, remaining) else {
                return false;
            };
            pending = next;
            if result.timed_out() && *pending != 0 {
                return false;
            }
        }
        true
    }

    fn shutdown(&self, timeout: Duration) -> bool {
        self.flush(timeout)
    }
}

fn finish_pending(pending: &(Mutex<usize>, Condvar)) {
    if let Ok(mut count) = pending.0.lock() {
        *count = count.saturating_sub(1);
        pending.1.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_filename_from_windows_registry_path() {
        assert_eq!(
            safe_filename(
                r"C:\Users\build-user\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tao-0.34.5\src\platform_impl\windows\event_loop\runner.rs"
            ),
            "runner.rs"
        );
    }

    #[test]
    fn enforces_daily_and_issue_caps() {
        let path = std::env::temp_dir().join(format!(
            "oyasumivr-error-budget-{}-{}.json",
            std::process::id(),
            current_day()
        ));
        let budget = EventBudget::new(
            path.clone(),
            EventBudgetConfig {
                first_event_cap: 2,
                recurrence_cap: 2,
                issue_cap: 3,
                recurrence_sample_rate: 1.0,
            },
        );
        assert!(budget.allow("a"));
        assert!(budget.allow("a"));
        assert!(budget.allow("a"));
        assert!(!budget.allow("a"));
        let budget = EventBudget::new(
            path.clone(),
            EventBudgetConfig {
                first_event_cap: 2,
                recurrence_cap: 2,
                issue_cap: 3,
                recurrence_sample_rate: 1.0,
            },
        );
        assert!(!budget.allow("a"));
        assert!(budget.allow("b"));
        assert!(!budget.allow("c"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn failed_persistence_does_not_consume_budget() {
        let parent = std::env::temp_dir().join(format!(
            "oyasumivr-error-budget-blocked-{}",
            std::process::id()
        ));
        fs::create_dir_all(&parent).unwrap();
        let path = parent.join("budget.json");
        fs::create_dir_all(path.with_extension("tmp")).unwrap();
        let budget = EventBudget::new(
            path.clone(),
            EventBudgetConfig {
                first_event_cap: 1,
                recurrence_cap: 0,
                issue_cap: 1,
                recurrence_sample_rate: 1.0,
            },
        );
        assert!(!budget.allow("a"));
        let state = budget.state.lock().unwrap();
        assert_eq!(state.first_events, 0);
        assert!(state.issues.is_empty());
        assert!(!path.exists());
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn resets_budget_on_a_new_day() {
        let path = std::env::temp_dir().join(format!(
            "oyasumivr-error-budget-rollover-{}-{}.json",
            std::process::id(),
            current_day()
        ));
        let budget = EventBudget::new(
            path.clone(),
            EventBudgetConfig {
                first_event_cap: 1,
                recurrence_cap: 0,
                issue_cap: 1,
                recurrence_sample_rate: 1.0,
            },
        );
        {
            let mut state = budget.state.lock().unwrap();
            state.day = current_day().saturating_sub(1);
            state.first_events = 1;
            state.recurrence_events = 1;
            state.issues.insert("old".into(), 1);
        }
        assert!(budget.allow("new"));
        let state = budget.state.lock().unwrap();
        assert_eq!(state.day, current_day());
        assert_eq!(state.first_events, 1);
        assert_eq!(state.recurrence_events, 0);
        assert_eq!(state.issues.get("new"), Some(&1));
        assert!(!state.issues.contains_key("old"));
        drop(state);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn uses_message_as_issue_key_without_an_exception() {
        let event = Event {
            message: Some("render failed".into()),
            ..Default::default()
        };
        assert_eq!(issue_key(&event), "render failed");
    }

    #[test]
    fn removes_sensitive_text_without_discarding_the_error() {
        let value = sanitize_text(
            "Failed to read C:\\Users\\John Doe\\config.json, Authorization: Bearer abc.def.ghi",
            false,
        );
        assert!(value.starts_with("Failed to read [redacted]"));
        assert!(!value.contains("John Doe"));
        assert!(!value.contains("abc.def.ghi"));
        assert!(!sanitize_text("Authorization: Bearer abc.def.ghi", false).contains("abc.def.ghi"));
        assert_eq!(
            sanitize_text(r"open \\server\John\secret.txt", false),
            "open [redacted]"
        );
        assert_eq!(
            sanitize_text("open C:/Users/John/secret.txt", false),
            "open [redacted]"
        );
        assert_eq!(sanitize_text("user USR_ABC123", false), "user [redacted]");
        assert_eq!(sanitize_text("anything", true), "elevated error");
    }

    #[test]
    fn removes_structured_sensitive_event_data() {
        let mut event = Event {
            user: Some(sentry::protocol::User {
                username: Some("John".into()),
                ..Default::default()
            }),
            request: Some(Default::default()),
            server_name: Some("private-host".into()),
            ..Default::default()
        };
        event.extra.insert("token".into(), "secret".into());
        event.tags.insert("private".into(), "secret".into());
        sanitize_event(&mut event, "core", "1.0.0");
        assert!(event.user.is_none());
        assert!(event.request.is_none());
        assert!(event.server_name.is_none());
        assert!(event.extra.is_empty());
        assert_eq!(event.tags.len(), 3);
    }

    #[test]
    fn attaches_only_the_running_exe_without_paths() {
        let mut event = Event::default();
        sanitize_event(&mut event, "core", "1.0.0");
        let [DebugImage::Symbolic(image)] = event.debug_meta.images.as_slice() else {
            panic!("expected exactly one symbolic image");
        };
        assert!(image.name.ends_with(".exe") && !image.name.contains(['/', '\\']));
        let debug_file = image.debug_file.as_deref().unwrap();
        assert!(debug_file.ends_with(".pdb") && !debug_file.contains(['/', '\\']));
        assert!(!image.id.is_nil());
        assert!(image.image_addr.0 != 0 && image.image_size > 0);
    }

    #[test]
    fn flush_waits_for_the_worker() {
        let (sender, _receiver) = mpsc::sync_channel(2);
        let pending = Arc::new((Mutex::new(1), Condvar::new()));
        let worker_pending = pending.clone();
        let transport = TinyTransport {
            sender,
            pending,
            enabled: Arc::new(AtomicBool::new(true)),
        };
        assert!(!transport.flush(Duration::ZERO));
        let worker = std::thread::spawn(move || {
            finish_pending(&worker_pending);
        });
        assert!(transport.flush(Duration::from_secs(1)));
        worker.join().unwrap();
        assert!(transport.flush(Duration::ZERO));
    }
}

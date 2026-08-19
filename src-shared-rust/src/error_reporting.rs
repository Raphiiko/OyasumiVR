use regex::Regex;
use sentry::{protocol::Event, ClientInitGuard, ClientOptions, Envelope, Transport};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
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
        let previous = state.clone();
        let day = current_day();
        if state.day != day {
            *state = BudgetState {
                day,
                first_events: 0,
                recurrence_events: 0,
                issues: BTreeMap::new(),
            };
        }
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
    let mut options = ClientOptions::new()
        .release(version)
        .send_default_pii(false)
        .max_breadcrumbs(0)
        .enable_logs(false)
        .enable_metrics(false)
        .shutdown_timeout(Duration::from_secs(2))
        .before_breadcrumb(|_| None)
        .before_send(move |mut event| {
            if !enabled.load(Ordering::Relaxed) {
                return None;
            }
            let budgeted = event
                .tags
                .get("budgeted")
                .is_some_and(|value| value == "true");
            sanitize_event(&mut event, component, version);
            (budgeted || issue_budget.allow(&issue_key(&event))).then_some(event)
        })
        .transport(TinyTransportFactory);
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
    if rate >= 1.0 {
        return true;
    }
    let mut value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    value ^= value >> 33;
    value = value.wrapping_mul(0xff51afd7ed558ccd);
    value ^= value >> 33;
    value as f64 / (u64::MAX as f64) < rate as f64
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
    let component = event
        .tags
        .get("component")
        .filter(|value| value.as_str() == "overlay")
        .cloned()
        .unwrap_or_else(|| component.to_owned());
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
    event.debug_meta = Default::default();
    event.breadcrumbs.values.clear();
    event.extra.clear();
    event.modules.clear();
    event
        .contexts
        .retain(|name, _| name == "os" || name == "runtime");
    event.tags.clear();
    event.tags.insert("component".into(), component);
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
struct TinyTransportFactory;

impl sentry::TransportFactory for TinyTransportFactory {
    fn create_transport(&self, options: &ClientOptions) -> Arc<dyn Transport> {
        Arc::new(TinyTransport::new(options))
    }
}

struct TinyTransport {
    sender: mpsc::SyncSender<Envelope>,
    pending: Arc<(Mutex<usize>, Condvar)>,
}

impl TinyTransport {
    fn new(options: &ClientOptions) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Envelope>(2);
        let pending = Arc::new((Mutex::new(0), Condvar::new()));
        let Some(dsn) = options.dsn.as_ref() else {
            return Self { sender, pending };
        };
        let url = dsn.envelope_api_url().to_string();
        let auth = dsn.to_auth(Some(&options.user_agent)).to_string();
        let worker_pending = pending.clone();
        let _ = std::thread::Builder::new().spawn(move || {
            let Ok(client) = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(1))
                .timeout(Duration::from_millis(1500))
                .build()
            else {
                return;
            };
            while let Ok(envelope) = receiver.recv() {
                let mut body = Vec::new();
                if envelope.to_writer(&mut body).is_ok() {
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
        Self { sender, pending }
    }
}

impl Transport for TinyTransport {
    fn send_envelope(&self, envelope: Envelope) {
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
        fs::write(&parent, []).unwrap();
        let budget = EventBudget::new(
            parent.join("budget.json"),
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
        let _ = fs::remove_file(parent);
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
        let mut event = Event::default();
        event.user = Some(sentry::protocol::User {
            username: Some("John".into()),
            ..Default::default()
        });
        event.request = Some(Default::default());
        event.server_name = Some("private-host".into());
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
    fn flush_waits_for_the_worker() {
        let (sender, _receiver) = mpsc::sync_channel(2);
        let pending = Arc::new((Mutex::new(1), Condvar::new()));
        let worker_pending = pending.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            finish_pending(&worker_pending);
        });
        let transport = TinyTransport { sender, pending };
        assert!(transport.flush(Duration::from_secs(1)));
    }
}

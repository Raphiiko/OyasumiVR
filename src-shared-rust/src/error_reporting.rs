use sentry::{protocol::Event, ClientInitGuard, ClientOptions, Envelope, Transport};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const DSN: &str = "https://a08e4e04b7a24cafb5eb6c4ff701e52e@sentry.raphii.co/1";

#[derive(Deserialize, Serialize)]
struct BudgetState {
    day: u64,
    total: u32,
    issues: BTreeMap<String, u32>,
}

pub struct EventBudget {
    path: PathBuf,
    daily_cap: u32,
    issue_cap: u32,
    state: Mutex<BudgetState>,
}

impl EventBudget {
    pub fn new(path: PathBuf, daily_cap: u32, issue_cap: u32) -> Self {
        let day = current_day();
        let state = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice(&data).ok())
            .filter(|state: &BudgetState| state.day == day)
            .unwrap_or(BudgetState {
                day,
                total: 0,
                issues: BTreeMap::new(),
            });
        Self {
            path,
            daily_cap,
            issue_cap,
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
                total: 0,
                issues: BTreeMap::new(),
            };
        }
        if state.total >= self.daily_cap
            || state.issues.get(issue).copied().unwrap_or_default() >= self.issue_cap
        {
            return false;
        }
        state.total += 1;
        *state.issues.entry(issue.to_owned()).or_default() += 1;
        persist(&self.path, &state).is_ok()
    }
}

pub fn init(
    component: &'static str,
    version: &'static str,
    budget: Arc<EventBudget>,
    sample_rate: f32,
    enabled: Arc<AtomicBool>,
) -> ClientInitGuard {
    let issue_budget = budget.clone();
    let mut options = ClientOptions::new()
        .release(version)
        .sample_rate(sample_rate)
        .send_default_pii(false)
        .max_breadcrumbs(0)
        .enable_logs(false)
        .enable_metrics(false)
        .shutdown_timeout(Duration::ZERO)
        .before_breadcrumb(|_| None)
        .before_send(move |mut event| {
            if !enabled.load(Ordering::Relaxed) {
                return None;
            }
            sanitize_event(&mut event, component, version);
            issue_budget.allow(&issue_key(&event)).then_some(event)
        })
        .transport(TinyTransportFactory);
    options.dsn = DSN.parse().ok();
    options.auto_session_tracking = false;
    let guard = sentry::init(options);
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

fn persist(path: &Path, state: &BudgetState) -> Result<(), ()> {
    let parent = path.parent().ok_or(())?;
    fs::create_dir_all(parent).map_err(|_| ())?;
    let data = serde_json::to_vec(state).map_err(|_| ())?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, data).map_err(|_| ())?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| ())?;
    }
    fs::rename(temporary, path).map_err(|_| ())
}

fn issue_key(event: &Event<'_>) -> String {
    if let Some(exception) = event.exception.values.first() {
        let frame = exception
            .stacktrace
            .as_ref()
            .and_then(|stack| stack.frames.last());
        return format!(
            "{}:{}:{}",
            exception.ty,
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
    let error_message = format!("{component} error");
    event.user = None;
    event.request = None;
    event.server_name = None;
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
    if let Some(message) = event.message.as_mut() {
        *message = error_message.clone();
    }
    for exception in &mut event.exception.values {
        exception.value = Some(error_message.clone());
        if let Some(stacktrace) = exception.stacktrace.as_mut() {
            for frame in &mut stacktrace.frames {
                frame.abs_path = None;
                frame.vars.clear();
                frame.pre_context.clear();
                frame.context_line = None;
                frame.post_context.clear();
                if let Some(filename) = frame.filename.as_mut() {
                    *filename = safe_filename(filename);
                }
            }
        }
    }
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
}

impl TinyTransport {
    fn new(options: &ClientOptions) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Envelope>(2);
        let Some(dsn) = options.dsn.as_ref() else {
            return Self { sender };
        };
        let url = dsn.envelope_api_url().to_string();
        let auth = dsn.to_auth(Some(&options.user_agent)).to_string();
        let _ = std::thread::Builder::new().spawn(move || {
            let Ok(client) = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(4))
                .build()
            else {
                return;
            };
            while let Ok(envelope) = receiver.recv() {
                let mut body = Vec::new();
                if envelope.to_writer(&mut body).is_err() {
                    continue;
                }
                let _ = client
                    .post(&url)
                    .header("X-Sentry-Auth", &auth)
                    .body(body)
                    .send();
            }
        });
        Self { sender }
    }
}

impl Transport for TinyTransport {
    fn send_envelope(&self, envelope: Envelope) {
        let _ = self.sender.try_send(envelope);
    }

    fn flush(&self, _timeout: Duration) -> bool {
        true
    }

    fn shutdown(&self, _timeout: Duration) -> bool {
        true
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
        let budget = EventBudget::new(path.clone(), 3, 2);
        assert!(budget.allow("a"));
        assert!(budget.allow("a"));
        assert!(!budget.allow("a"));
        let budget = EventBudget::new(path.clone(), 3, 2);
        assert!(!budget.allow("a"));
        assert!(budget.allow("b"));
        assert!(!budget.allow("c"));
        let _ = fs::remove_file(path);
    }
}

use std::{
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

use tokio::sync::broadcast;

use crate::{
    brightness::{self, Backend},
    cct::{self, ColorGains},
    controls::{Control, Controls, FadeError, FadeReport, FadeRequest, Outcome},
};

/// A boot clock that runs this much further than the monotonic one means the system slept.
const SUSPEND_GAP: Duration = Duration::from_secs(1);

pub struct Command {
    pub connection: u64,
    pub id: u64,
    pub action: Action,
}

pub enum Action {
    SetBrightness(f64),
    SetCct(i64),
    Fade(FadeRequest),
    CancelFade(String),
    BeginMaintenance,
    EndMaintenance,
}

/// `cause` names the connection whose write produced a snapshot; that connection gets a reply
/// instead.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Brightness {
        snapshot: brightness::Snapshot,
        fade: Option<FadeReport>,
        cause: Option<u64>,
    },
    Cct {
        snapshot: cct::Snapshot,
        fade: Option<FadeReport>,
        cause: Option<u64>,
    },
    BrightnessReply {
        connection: u64,
        id: u64,
        result: Result<f64, brightness::SetError>,
    },
    CctReply {
        connection: u64,
        id: u64,
        result: Result<cct::Snapshot, cct::SetError>,
    },
    FadeReply {
        connection: u64,
        id: u64,
        result: Result<(), FadeError>,
    },
    FadeEnded {
        control: Control,
        operation: String,
        outcome: Outcome,
    },
    /// False when a hold was refused because a fade runs.
    MaintenanceReply {
        connection: u64,
        id: u64,
        held: bool,
    },
    /// A maintenance hold began or ended.
    Hold(bool),
}

#[derive(Clone, Debug)]
pub struct Latest {
    pub brightness: brightness::Snapshot,
    pub brightness_fade: Option<FadeReport>,
    pub cct: cct::Snapshot,
    pub cct_fade: Option<FadeReport>,
}

/// Connects the headset task with the PC connections.
pub struct Hub {
    /// Held while an event is sent, so a new subscriber never receives an event older than the
    /// snapshots it starts from.
    latest: Mutex<Latest>,
    events: broadcast::Sender<Event>,
    commands: mpsc::Sender<Command>,
}

impl Hub {
    /// The current snapshots and every event after them.
    pub fn subscribe(&self) -> (Latest, broadcast::Receiver<Event>) {
        let latest = self.latest.lock().unwrap();
        (latest.clone(), self.events.subscribe())
    }

    pub fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }

    fn publish(&self, event: Event) {
        let mut latest = self.latest.lock().unwrap();
        match &event {
            Event::Brightness { snapshot, fade, .. } => {
                latest.brightness = snapshot.clone();
                latest.brightness_fade = fade.clone();
            }
            Event::Cct { snapshot, fade, .. } => {
                latest.cct = snapshot.clone();
                latest.cct_fade = fade.clone();
            }
            _ => {}
        }
        let _ = self.events.send(event);
    }
}

/// Runs the headset task on its own thread, with one SteamVR session for brightness and color
/// temperature: a poll every 250 ms, fade steps at 60 Hz, and commands in order.
pub fn start<B: Backend + ColorGains + Send + 'static>(backend: B) -> Arc<Hub> {
    let (commands, receiver) = mpsc::channel();
    let hub = Arc::new(Hub {
        latest: Mutex::new(Latest {
            brightness: brightness::Snapshot::UNAVAILABLE,
            brightness_fade: None,
            cct: cct::Snapshot::UNAVAILABLE,
            cct_fade: None,
        }),
        events: broadcast::channel(256).0,
        commands,
    });
    let task_hub = hub.clone();
    std::thread::spawn(move || run(Controls::new(backend, Instant::now()), &task_hub, receiver));
    hub
}

fn run<B: Backend + ColorGains>(
    mut controls: Controls<B>,
    hub: &Hub,
    commands: mpsc::Receiver<Command>,
) {
    let mut clock = SuspendClock::default();
    loop {
        let wait = controls
            .next_wake()
            .saturating_duration_since(Instant::now());
        let received = commands.recv_timeout(wait);
        // tick first, so a suspend ends the old fades and not one a command starts after resume
        controls.tick(Instant::now(), clock.suspended());
        match received {
            Ok(command) => controls.command(command, Instant::now()),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        for event in controls.take_events() {
            hub.publish(event);
        }
    }
}

/// Notices a system suspend, during which the boot clock runs on and the monotonic one stops.
#[derive(Default)]
struct SuspendClock {
    last: Option<(Instant, Duration)>,
}

impl SuspendClock {
    fn suspended(&mut self) -> bool {
        let Some(boot) = boot_time() else {
            return false;
        };
        let now = Instant::now();
        self.last
            .replace((now, boot))
            .is_some_and(|(then, boot_then)| slept(now - then, boot.saturating_sub(boot_then)))
    }
}

/// True when the boot clock advanced more than [`SUSPEND_GAP`] beyond the monotonic clock.
pub fn slept(monotonic: Duration, boot: Duration) -> bool {
    boot > monotonic + SUSPEND_GAP
}

#[cfg(target_os = "linux")]
fn boot_time() -> Option<Duration> {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `time` is a valid timespec for the call to write into
    let result = unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut time) };
    (result == 0).then(|| Duration::new(time.tv_sec as u64, time.tv_nsec as u32))
}

#[cfg(not(target_os = "linux"))]
fn boot_time() -> Option<Duration> {
    None
}

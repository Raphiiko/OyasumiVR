use std::{
    sync::{mpsc, Arc, Mutex},
    time::Instant,
};

use tokio::sync::broadcast;

use crate::{
    brightness::{self, Backend, Brightness, POLL_INTERVAL},
    cct::{self, Cct, ColorGains},
};

pub struct Command {
    pub connection: u64,
    pub id: u64,
    pub action: Action,
}

pub enum Action {
    SetBrightness(f64),
    SetCct(i64),
}

/// `cause` names the connection whose write produced a snapshot; that connection gets a reply
/// instead.
#[derive(Clone, Debug)]
pub enum Event {
    Brightness {
        snapshot: brightness::Snapshot,
        cause: Option<u64>,
    },
    Cct {
        snapshot: cct::Snapshot,
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
}

#[derive(Clone, Debug)]
pub struct Latest {
    pub brightness: brightness::Snapshot,
    pub cct: cct::Snapshot,
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
            Event::Brightness { snapshot, .. } => latest.brightness = snapshot.clone(),
            Event::Cct { snapshot, .. } => latest.cct = snapshot.clone(),
            Event::BrightnessReply { .. } | Event::CctReply { .. } => {}
        }
        let _ = self.events.send(event);
    }
}

/// Runs the headset task on its own thread, with one SteamVR session for brightness and color
/// temperature: a poll every 250 ms, and commands in order.
pub fn start<B: Backend + ColorGains + Send + 'static>(backend: B) -> Arc<Hub> {
    let (commands, receiver) = mpsc::channel();
    let hub = Arc::new(Hub {
        latest: Mutex::new(Latest {
            brightness: brightness::Snapshot::UNAVAILABLE,
            cct: cct::Snapshot::UNAVAILABLE,
        }),
        events: broadcast::channel(256).0,
        commands,
    });
    let task_hub = hub.clone();
    std::thread::spawn(move || run(Brightness::new(backend), &task_hub, receiver));
    hub
}

fn run<B: Backend + ColorGains>(
    mut brightness: Brightness<B>,
    hub: &Hub,
    commands: mpsc::Receiver<Command>,
) {
    let mut cct = Cct::default();
    let mut next_poll = Instant::now();
    loop {
        match commands.recv_timeout(next_poll.saturating_duration_since(Instant::now())) {
            Ok(Command {
                connection,
                id,
                action: Action::SetBrightness(percentage),
            }) => {
                let outcome = brightness.set(percentage);
                if let Some(snapshot) = outcome.before {
                    hub.publish(Event::Brightness {
                        snapshot,
                        cause: None,
                    });
                }
                if let Some(snapshot) = outcome.after {
                    hub.publish(Event::Brightness {
                        snapshot,
                        cause: Some(connection),
                    });
                }
                hub.publish(Event::BrightnessReply {
                    connection,
                    id,
                    result: outcome.result,
                });
            }
            Ok(Command {
                connection,
                id,
                action: Action::SetCct(kelvin),
            }) => {
                let outcome = cct.set(brightness.session(), kelvin);
                if let Some(snapshot) = outcome.before {
                    hub.publish(Event::Cct {
                        snapshot,
                        cause: None,
                    });
                }
                if let Some(snapshot) = outcome.after {
                    hub.publish(Event::Cct {
                        snapshot,
                        cause: Some(connection),
                    });
                }
                hub.publish(Event::CctReply {
                    connection,
                    id,
                    result: outcome.result,
                });
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // brightness opens and closes the session, so it polls first
                if let Some(snapshot) = brightness.poll() {
                    hub.publish(Event::Brightness {
                        snapshot,
                        cause: None,
                    });
                }
                if let Some(snapshot) = cct.poll(brightness.session()) {
                    hub.publish(Event::Cct {
                        snapshot,
                        cause: None,
                    });
                }
                next_poll = Instant::now() + POLL_INTERVAL;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

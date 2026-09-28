use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use raphii_openvr_rs::{raw, Context, TrackedDeviceIndex};
use serde::Serialize;

pub const POLL_INTERVAL: Duration = Duration::from_millis(250);
const RECONNECT_INTERVAL: Duration = Duration::from_secs(2);
/// A read that differs from the last known gain by more than this is a change made elsewhere.
const GAIN_TOLERANCE: f32 = 1e-5;
const MIN_PERCENTAGE: f64 = 9.0;
const MAX_PERCENTAGE: f64 = 125.0;
const GAMMA: f64 = 2.2;
const DEFAULT_RUNTIME: &str = "/opt/steamvr";

/// The same curve as the Index driver on the PC: gamma below 100%, linear from there.
pub fn gain_to_percentage(gain: f64) -> f64 {
    if gain >= 1.0 {
        gain * 100.0
    } else {
        gain.max(0.0).powf(1.0 / GAMMA) * 100.0
    }
}

pub fn percentage_to_gain(percentage: f64) -> f64 {
    if percentage >= 100.0 {
        percentage / 100.0
    } else {
        (percentage.max(0.0) / 100.0).powf(GAMMA)
    }
}

fn round(percentage: f64) -> f64 {
    (percentage * 100.0).round() / 100.0
}

/// The HMD's analog gain support. Both limits are gain units, not percentages.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Capability {
    pub supported: bool,
    pub min_gain: f32,
    pub max_gain: f32,
}

impl Capability {
    pub const UNSUPPORTED: Self = Self {
        supported: false,
        min_gain: 0.0,
        max_gain: 0.0,
    };

    /// The writable range in percent, within 9%–125%.
    pub fn bounds(&self) -> (f64, f64) {
        let min = MIN_PERCENTAGE.max(round(gain_to_percentage(self.min_gain as f64)));
        let max = MAX_PERCENTAGE.min(round(gain_to_percentage(self.max_gain as f64)));
        (min, max.max(min))
    }

    fn differs(&self, other: &Self) -> bool {
        self.supported != other.supported
            || (self.min_gain - other.min_gain).abs() > GAIN_TOLERANCE
            || (self.max_gain - other.max_gain).abs() > GAIN_TOLERANCE
    }
}

/// The runtime session is gone.
#[derive(Debug)]
pub struct RuntimeLost;

pub trait Backend {
    /// Opens a runtime session. False while SteamVR is not running.
    fn connect(&mut self) -> bool;
    fn disconnect(&mut self);
    fn capability(&mut self) -> Result<Capability, RuntimeLost>;
    fn gain(&mut self) -> Result<f32, RuntimeLost>;
    fn set_gain(&mut self, gain: f32) -> Result<(), RuntimeLost>;
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// False while no SteamVR session is open; nothing else is known then.
    pub runtime: bool,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// The headset's current value, which can lie outside `min` and `max`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentage: Option<f64>,
}

impl Snapshot {
    pub const UNAVAILABLE: Self = Self {
        runtime: false,
        supported: false,
        min: None,
        max: None,
        percentage: None,
    };
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SetError {
    Unsupported,
    RuntimeUnavailable,
    WriteFailed,
}

#[derive(Debug, PartialEq)]
pub struct SetOutcome {
    /// A change made elsewhere, found by the read before the write.
    pub before: Option<Snapshot>,
    pub result: Result<f64, SetError>,
    /// The state after a successful write.
    pub after: Option<Snapshot>,
}

/// Tracks the headset's brightness. Only `set` writes; `poll` only reads.
pub struct Brightness<B> {
    backend: B,
    connected: bool,
    capability: Capability,
    /// The last gain read or written, which a later read is compared with.
    last_gain: Option<f32>,
    snapshot: Snapshot,
}

impl<B: Backend> Brightness<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            connected: false,
            capability: Capability::UNSUPPORTED,
            last_gain: None,
            snapshot: Snapshot::UNAVAILABLE,
        }
    }

    pub fn snapshot(&self) -> &Snapshot {
        &self.snapshot
    }

    /// The backend while a runtime session is open.
    pub fn session(&mut self) -> Option<&mut B> {
        self.connected.then_some(&mut self.backend)
    }

    /// Reads the headset and returns a new snapshot when anything changed since the last read or
    /// write.
    pub fn poll(&mut self) -> Option<Snapshot> {
        // open a session while none is open
        if !self.connected {
            if !self.backend.connect() {
                return None;
            }
            self.connected = true;
        }

        // read capability and gain, or drop the session
        let read = self.backend.capability().and_then(|capability| {
            // property reads can outlive the runtime, but the settings read fails without it
            let gain = self.backend.gain()?;
            Ok((capability, capability.supported.then_some(gain)))
        });
        let Ok((capability, gain)) = read else {
            self.backend.disconnect();
            self.connected = false;
            self.last_gain = None;
            return self.publish(Snapshot::UNAVAILABLE);
        };

        // report a capability change or a gain change made elsewhere
        let gain_changed = match (gain, self.last_gain) {
            (Some(gain), Some(last)) => (gain - last).abs() > GAIN_TOLERANCE,
            (gain, last) => gain.is_some() != last.is_some(),
        };
        if capability.differs(&self.capability) {
            self.capability = capability;
        }
        if gain_changed {
            self.last_gain = gain;
        }
        self.publish(self.current())
    }

    /// Reads first, so a change made elsewhere is reported before this write replaces it.
    pub fn set(&mut self, percentage: f64) -> SetOutcome {
        let before = self.poll();
        let result = self.write(percentage);
        let after = match result {
            Ok(_) => self.publish(self.current()),
            Err(_) => None,
        };
        SetOutcome {
            before,
            result,
            after,
        }
    }

    fn write(&mut self, percentage: f64) -> Result<f64, SetError> {
        if !self.connected {
            return Err(SetError::RuntimeUnavailable);
        }
        if !self.capability.supported {
            return Err(SetError::Unsupported);
        }
        let (min, max) = self.capability.bounds();
        // the bounds are rounded, so the gain limits apply once more
        let gain = (percentage_to_gain(percentage.clamp(min, max)) as f32)
            .max(self.capability.min_gain)
            .min(self.capability.max_gain);
        self.backend
            .set_gain(gain)
            .map_err(|RuntimeLost| SetError::WriteFailed)?;
        self.last_gain = Some(gain);
        Ok(round(gain_to_percentage(gain as f64)))
    }

    fn current(&self) -> Snapshot {
        if !self.capability.supported {
            return Snapshot {
                runtime: true,
                ..Snapshot::UNAVAILABLE
            };
        }
        let (min, max) = self.capability.bounds();
        Snapshot {
            runtime: true,
            supported: true,
            min: Some(min),
            max: Some(max),
            percentage: self
                .last_gain
                .map(|gain| round(gain_to_percentage(gain as f64))),
        }
    }

    fn publish(&mut self, snapshot: Snapshot) -> Option<Snapshot> {
        if snapshot == self.snapshot {
            return None;
        }
        self.snapshot = snapshot.clone();
        Some(snapshot)
    }
}

/// Reads and writes `steamvr.analogGain` through the installed SteamVR runtime.
#[derive(Default)]
pub struct OpenVr {
    context: Option<Context>,
    last_attempt: Option<Instant>,
}

impl OpenVr {
    pub(crate) fn context(&self) -> Result<&Context, RuntimeLost> {
        self.context.as_ref().ok_or(RuntimeLost)
    }
}

/// The client library of the runtime SteamVR registered for this user.
fn library_path() -> PathBuf {
    let registered = std::env::var_os("HOME").and_then(|home| {
        let paths = std::fs::read(Path::new(&home).join(".config/openvr/openvrpaths.vrpath"));
        let paths: serde_json::Value = serde_json::from_slice(&paths.ok()?).ok()?;
        Some(PathBuf::from(paths.get("runtime")?.get(0)?.as_str()?))
    });
    registered
        .unwrap_or_else(|| DEFAULT_RUNTIME.into())
        .join("bin/linuxarm64/libopenvr_api.so")
}

impl Backend for OpenVr {
    fn connect(&mut self) -> bool {
        if self
            .last_attempt
            .is_some_and(|attempt| attempt.elapsed() < RECONNECT_INTERVAL)
        {
            return false;
        }
        self.last_attempt = Some(Instant::now());
        // SAFETY: this is the only code in the helper that initializes or shuts down OpenVR
        let context = unsafe {
            Context::init_from_path(
                &library_path(),
                raw::EVRApplicationType::VRApplication_Background,
            )
        };
        self.context = context.ok();
        self.context.is_some()
    }

    fn disconnect(&mut self) {
        if let Some(context) = self.context.take() {
            context.shutdown();
        }
        // a SteamVR that is shutting down would accept a new session and then drop it
        self.last_attempt = Some(Instant::now());
    }

    fn capability(&mut self) -> Result<Capability, RuntimeLost> {
        let system = self.context()?.system();
        // SteamVR asks background apps to exit with a quit event
        while let Some(event) = system.poll_next_event().map_err(|_| RuntimeLost)? {
            if event.is(raw::EVREventType::VREvent_Quit) {
                return Err(RuntimeLost);
            }
        }
        let hmd = TrackedDeviceIndex::HMD;
        // a headset that cannot report a value does not support gain control
        let capability = (|| {
            Ok::<_, raphii_openvr_rs::Error>(Capability {
                supported: system.get_tracked_device_property(
                    hmd,
                    raw::ETrackedDeviceProperty::Prop_DisplaySupportsAnalogGain_Bool,
                )?,
                min_gain: system.get_tracked_device_property(
                    hmd,
                    raw::ETrackedDeviceProperty::Prop_DisplayMinAnalogGain_Float,
                )?,
                max_gain: system.get_tracked_device_property(
                    hmd,
                    raw::ETrackedDeviceProperty::Prop_DisplayMaxAnalogGain_Float,
                )?,
            })
        })();
        Ok(capability.unwrap_or(Capability::UNSUPPORTED))
    }

    fn gain(&mut self) -> Result<f32, RuntimeLost> {
        self.context()?
            .settings()
            .get_float(c"steamvr", c"analogGain")
            .map_err(|_| RuntimeLost)
    }

    fn set_gain(&mut self, gain: f32) -> Result<(), RuntimeLost> {
        self.context()?
            .settings()
            .set_float(c"steamvr", c"analogGain", gain)
            .map_err(|_| RuntimeLost)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    const FRAME: Capability = Capability {
        supported: true,
        min_gain: 0.005,
        max_gain: 1.25,
    };

    #[derive(Default)]
    struct Headset {
        running: bool,
        /// Property reads keep answering "unsupported" after the runtime is gone.
        stale_properties: bool,
        capability: Option<Capability>,
        gain: f32,
        writes: Vec<f32>,
        /// Every backend call in order, to check that a read comes before a write.
        calls: Vec<&'static str>,
    }

    #[derive(Clone, Default)]
    struct Fake(Arc<Mutex<Headset>>);

    impl Fake {
        fn running(gain: f32) -> Self {
            let fake = Self::default();
            fake.edit(|headset| {
                headset.running = true;
                headset.capability = Some(FRAME);
                headset.gain = gain;
            });
            fake
        }

        fn edit<T>(&self, change: impl FnOnce(&mut Headset) -> T) -> T {
            change(&mut self.0.lock().unwrap())
        }
    }

    impl Backend for Fake {
        fn connect(&mut self) -> bool {
            self.edit(|headset| headset.running)
        }

        fn disconnect(&mut self) {}

        fn capability(&mut self) -> Result<Capability, RuntimeLost> {
            self.edit(
                |headset| match (headset.running, headset.stale_properties) {
                    (true, _) => Ok(headset.capability.unwrap_or(Capability::UNSUPPORTED)),
                    (false, true) => Ok(Capability::UNSUPPORTED),
                    (false, false) => Err(RuntimeLost),
                },
            )
        }

        fn gain(&mut self) -> Result<f32, RuntimeLost> {
            self.edit(|headset| {
                headset.calls.push("read");
                headset.running.then_some(headset.gain).ok_or(RuntimeLost)
            })
        }

        fn set_gain(&mut self, gain: f32) -> Result<(), RuntimeLost> {
            self.edit(|headset| {
                headset.calls.push("write");
                headset.writes.push(gain);
                headset.gain = gain;
                Ok(())
            })
        }
    }

    fn snapshot(percentage: f64) -> Snapshot {
        Snapshot {
            runtime: true,
            supported: true,
            min: Some(9.0),
            max: Some(125.0),
            percentage: Some(percentage),
        }
    }

    #[test]
    fn converts_like_the_index_driver() {
        assert_eq!(gain_to_percentage(1.0), 100.0);
        assert_eq!(gain_to_percentage(1.25), 125.0);
        assert!((gain_to_percentage(0.5f64.powf(2.2)) - 50.0).abs() < 1e-9);
        assert_eq!(percentage_to_gain(125.0), 1.25);
        assert!((percentage_to_gain(50.0) - 0.5f64.powf(2.2)).abs() < 1e-12);
        for percentage in [9.0, 37.5, 99.0, 100.0, 118.0] {
            assert!((gain_to_percentage(percentage_to_gain(percentage)) - percentage).abs() < 1e-9);
        }
    }

    #[test]
    fn bounds_come_from_gain_limits() {
        // 0.005 gain is 9%, not 0.5%
        assert_eq!(FRAME.bounds(), (9.0, 125.0));
        let narrow = Capability {
            supported: true,
            min_gain: 0.04,
            max_gain: 0.9,
        };
        assert_eq!(narrow.bounds(), (23.15, 95.32));
        let wide = Capability {
            supported: true,
            min_gain: 0.0,
            max_gain: 1.6,
        };
        assert_eq!(wide.bounds(), (9.0, 125.0));
    }

    #[test]
    fn clamps_every_write_to_the_bounds() {
        let fake = Fake::running(1.0);
        let mut brightness = Brightness::new(fake.clone());
        assert_eq!(brightness.set(200.0).result, Ok(125.0));
        assert_eq!(brightness.set(1.0).result, Ok(9.0));
        let writes = fake.edit(|headset| headset.writes.clone());
        assert_eq!(writes, [1.25, percentage_to_gain(9.0) as f32]);
    }

    #[test]
    fn keeps_writes_within_the_gain_limits_despite_rounded_bounds() {
        let fake = Fake::running(0.5);
        fake.edit(|headset| {
            headset.capability = Some(Capability {
                supported: true,
                min_gain: 0.04,
                max_gain: 0.9,
            })
        });
        let mut brightness = Brightness::new(fake.clone());
        brightness.set(9.0);
        brightness.set(200.0);
        let writes = fake.edit(|headset| headset.writes.clone());
        assert_eq!(writes[0], 0.04);
        assert!((0.8999..=0.9).contains(&writes[1]), "{writes:?}");
    }

    #[test]
    fn notices_runtime_loss_while_properties_still_answer() {
        let fake = Fake::running(1.0);
        fake.edit(|headset| headset.stale_properties = true);
        let mut brightness = Brightness::new(fake.clone());
        brightness.poll();
        fake.edit(|headset| headset.running = false);
        assert_eq!(brightness.poll(), Some(Snapshot::UNAVAILABLE));
        fake.edit(|headset| headset.running = true);
        assert_eq!(brightness.poll(), Some(snapshot(100.0)));
    }

    #[test]
    fn reports_the_headset_on_start_without_writing() {
        let fake = Fake::running(1.0);
        let mut brightness = Brightness::new(fake.clone());
        assert_eq!(brightness.snapshot(), &Snapshot::UNAVAILABLE);
        assert_eq!(brightness.poll(), Some(snapshot(100.0)));
        assert_eq!(brightness.poll(), None);
        assert!(fake.edit(|headset| headset.writes.is_empty()));
    }

    #[test]
    fn reports_each_external_change_once() {
        let fake = Fake::running(1.0);
        let mut brightness = Brightness::new(fake.clone());
        brightness.poll();
        fake.edit(|headset| headset.gain = 0.5f32.powf(2.2));
        assert_eq!(brightness.poll(), Some(snapshot(50.0)));
        assert_eq!(brightness.poll(), None);
        // a difference within the tolerance is no change
        fake.edit(|headset| headset.gain += 5e-6);
        assert_eq!(brightness.poll(), None);
    }

    #[test]
    fn does_not_report_its_own_write() {
        let fake = Fake::running(1.0);
        let mut brightness = Brightness::new(fake.clone());
        brightness.poll();
        let outcome = brightness.set(50.0);
        assert_eq!(outcome.before, None);
        assert_eq!(outcome.result, Ok(50.0));
        assert_eq!(outcome.after, Some(snapshot(50.0)));
        assert_eq!(brightness.poll(), None);
    }

    #[test]
    fn reports_a_change_between_poll_and_write_before_the_write() {
        let fake = Fake::running(1.0);
        let mut brightness = Brightness::new(fake.clone());
        brightness.poll();
        fake.edit(|headset| {
            headset.gain = 1.1;
            headset.calls.clear();
        });
        let outcome = brightness.set(60.0);
        assert_eq!(outcome.before, Some(snapshot(110.0)));
        assert_eq!(outcome.result, Ok(60.0));
        assert_eq!(
            fake.edit(|headset| headset.calls.clone()),
            ["read", "write"]
        );
    }

    #[test]
    fn refuses_writes_without_gain_support() {
        let fake = Fake::running(1.0);
        fake.edit(|headset| headset.capability = Some(Capability::UNSUPPORTED));
        let mut brightness = Brightness::new(fake.clone());
        let unsupported = Snapshot {
            runtime: true,
            ..Snapshot::UNAVAILABLE
        };
        assert_eq!(brightness.poll(), Some(unsupported));
        assert_eq!(brightness.set(50.0).result, Err(SetError::Unsupported));
        // gaining support is a capability change
        fake.edit(|headset| headset.capability = Some(FRAME));
        assert_eq!(brightness.poll(), Some(snapshot(100.0)));
        assert!(fake.edit(|headset| headset.writes.is_empty()));
    }

    #[test]
    fn follows_runtime_loss_and_return_without_writing() {
        let fake = Fake::default();
        let mut brightness = Brightness::new(fake.clone());
        assert_eq!(brightness.poll(), None);
        assert_eq!(
            brightness.set(50.0).result,
            Err(SetError::RuntimeUnavailable)
        );
        fake.edit(|headset| {
            headset.running = true;
            headset.capability = Some(FRAME);
            headset.gain = 0.5f32.powf(2.2);
        });
        assert_eq!(brightness.poll(), Some(snapshot(50.0)));
        fake.edit(|headset| headset.running = false);
        assert_eq!(brightness.poll(), Some(Snapshot::UNAVAILABLE));
        assert_eq!(
            brightness.set(80.0).result,
            Err(SetError::RuntimeUnavailable)
        );
        // the same value returns as a new snapshot after the runtime comes back
        fake.edit(|headset| headset.running = true);
        assert_eq!(brightness.poll(), Some(snapshot(50.0)));
        assert!(fake.edit(|headset| headset.writes.is_empty()));
    }
}

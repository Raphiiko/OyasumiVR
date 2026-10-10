use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::{
    brightness::{Backend, Brightness, SetError, POLL_INTERVAL},
    cct::{self, Cct, ColorGains},
    hub::{Action, Command, Event},
};

/// 60 Hz.
pub const STEP_INTERVAL: Duration = Duration::from_nanos(16_666_667);
const REPORT_INTERVAL: Duration = Duration::from_millis(250);
/// The longest fade the helper accepts, well inside what `Instant` arithmetic can hold.
pub const MAX_DURATION: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Control {
    Brightness,
    Cct,
}

const CONTROLS: [Control; 2] = [Control::Brightness, Control::Cct];

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Completed,
    /// Another set or fade command for the same control replaced it.
    Superseded,
    /// A PC cancelled it by its operation ID.
    Cancelled,
    ExternalChange,
    Standby,
    RuntimeUnavailable,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FadeError {
    Unsupported,
    RuntimeUnavailable,
    WriteFailed,
}

impl From<SetError> for FadeError {
    fn from(error: SetError) -> Self {
        match error {
            SetError::Unsupported => Self::Unsupported,
            SetError::RuntimeUnavailable => Self::RuntimeUnavailable,
            SetError::WriteFailed => Self::WriteFailed,
        }
    }
}

impl From<cct::SetError> for FadeError {
    fn from(error: cct::SetError) -> Self {
        match error {
            cct::SetError::RuntimeUnavailable => Self::RuntimeUnavailable,
            cct::SetError::WriteFailed => Self::WriteFailed,
        }
    }
}

/// A fade command. `target` is in percent or Kelvin. `simple` is a simple-mode curve from and to,
/// which the helper maps to hardware brightness at every step; it applies to brightness only.
#[derive(Debug, Clone, PartialEq)]
pub struct FadeRequest {
    pub control: Control,
    pub operation: String,
    pub target: f64,
    pub duration: Duration,
    pub simple: Option<(f64, f64)>,
}

struct Fade {
    operation: String,
    /// The value read at acceptance.
    from: f64,
    target: f64,
    simple: Option<(f64, f64)>,
    start: Instant,
    duration: Duration,
    next_step: Instant,
    next_report: Instant,
}

impl Fade {
    /// The value at `now`, and whether the fade is done. The last step is the target.
    fn value(&self, now: Instant, bounds: Option<(f64, f64)>) -> (f64, bool) {
        let progress =
            now.saturating_duration_since(self.start).as_secs_f64() / self.duration.as_secs_f64();
        if progress >= 1.0 {
            return (self.target, true);
        }
        let eased = smoothstep(progress);
        let value = match (self.simple, bounds) {
            (Some((from, to)), Some((min, max))) => {
                simple_to_hardware(from + eased * (to - from), min, max)
            }
            _ => self.from + eased * (self.target - self.from),
        };
        (value, false)
    }
}

/// The same easing as `smoothLerp` on the PC.
fn smoothstep(progress: f64) -> f64 {
    progress * progress * (3.0 - 2.0 * progress)
}

/// The hardware part of a simple-mode value, as `SimpleBrightnessControlService.setBrightness`
/// splits it: the floor below the hardware minimum, where software dimming takes over.
pub fn simple_to_hardware(simple: f64, min: f64, max: f64) -> f64 {
    if simple < min || min >= 100.0 {
        return min;
    }
    min + (max - min) * (simple - min) / (100.0 - min)
}

/// The values written during one headset standby.
#[derive(Default)]
struct StandbyWrites {
    brightness: Option<f64>,
    cct: Option<i64>,
}

/// Brightness and color temperature on one SteamVR session: polls, commands, fades, headset
/// standby. The caller passes the time, so tests control the clock.
pub struct Controls<B> {
    brightness: Brightness<B>,
    cct: Cct,
    fades: [Option<Fade>; 2],
    /// Set while the headset is in standby.
    standby: Option<StandbyWrites>,
    next_poll: Instant,
    /// The time of the current tick or command.
    now: Instant,
    events: Vec<Event>,
}

impl<B: Backend + ColorGains> Controls<B> {
    pub fn new(backend: B, now: Instant) -> Self {
        Self {
            brightness: Brightness::new(backend),
            cct: Cct::default(),
            fades: [None, None],
            standby: None,
            next_poll: now,
            now,
            events: Vec::new(),
        }
    }

    /// The events since the last call, in order.
    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    /// When `tick` has work next.
    pub fn next_wake(&self) -> Instant {
        self.fades
            .iter()
            .flatten()
            .map(|fade| fade.next_step)
            .fold(self.next_poll, Instant::min)
    }

    /// Runs the work due at `now`. `suspended` says the system slept since the last tick.
    pub fn tick(&mut self, now: Instant, suspended: bool) {
        self.now = now;
        if suspended {
            self.enter_standby();
        }
        if self.next_poll <= now {
            self.poll();
            self.next_poll = now + POLL_INTERVAL;
        }
        for control in CONTROLS {
            if self.fade(control).is_some_and(|fade| fade.next_step <= now) {
                self.step(control);
            }
        }
    }

    pub fn command(&mut self, command: Command, now: Instant) {
        self.now = now;
        let Command {
            connection,
            id,
            action,
        } = command;
        match action {
            Action::SetBrightness(percentage) => {
                self.read_standby();
                let result = self.set_brightness(percentage, Some(connection));
                self.events.push(Event::BrightnessReply {
                    connection,
                    id,
                    result,
                });
            }
            Action::SetCct(kelvin) => {
                self.read_standby();
                let result = self.set_cct(kelvin, Some(connection));
                self.events.push(Event::CctReply {
                    connection,
                    id,
                    result,
                });
            }
            Action::Fade(request) => {
                let (control, operation) = (request.control, request.operation.clone());
                let result = self.start_fade(request);
                self.events.push(Event::FadeReply {
                    connection,
                    id,
                    result: result.map(|_| ()),
                });
                if result == Ok(true) {
                    self.events.push(Event::FadeEnded {
                        control,
                        operation,
                        outcome: Outcome::Completed,
                    });
                }
            }
            Action::CancelFade(operation) => {
                for control in CONTROLS {
                    if self
                        .fade(control)
                        .is_some_and(|fade| fade.operation == operation)
                    {
                        self.end_fade(control, Outcome::Cancelled);
                    }
                }
            }
        }
    }

    fn fade(&self, control: Control) -> Option<&Fade> {
        self.fades[control as usize].as_ref()
    }

    fn poll(&mut self) {
        // brightness opens and closes the session, so it reads first
        let brightness = self.brightness.poll();
        let cct = self.cct.poll(self.brightness.session());
        self.report_change(Control::Brightness, brightness.is_some());
        self.report_change(Control::Cct, cct.is_some());
        self.after_read();
        self.read_standby();
    }

    /// Ends the fades a read made obsolete: every fade on runtime loss, and the fade of a control
    /// the headset changed.
    fn after_read(&mut self) {
        let external = [
            self.brightness.take_external_change(),
            self.cct.take_external_change(),
        ];
        if self.brightness.session().is_none() {
            self.standby = None;
            for control in CONTROLS {
                self.end_fade(control, Outcome::RuntimeUnavailable);
            }
            return;
        }
        for control in CONTROLS {
            if external[control as usize] {
                self.end_fade(control, Outcome::ExternalChange);
            }
        }
    }

    /// Reads the HMD activity level and follows standby entry and exit.
    fn read_standby(&mut self) {
        let Some(session) = self.brightness.session() else {
            return;
        };
        let standby = session.standby().unwrap_or(false);
        match (standby, self.standby.is_some()) {
            (true, false) => self.enter_standby(),
            (false, true) => self.leave_standby(),
            _ => {}
        }
    }

    fn enter_standby(&mut self) {
        if self.standby.is_some() {
            return;
        }
        self.standby = Some(StandbyWrites::default());
        for control in CONTROLS {
            self.end_fade(control, Outcome::Standby);
        }
    }

    /// Reads both controls, and writes a value from this standby once more when the read differs.
    fn leave_standby(&mut self) {
        let Some(written) = self.standby.take() else {
            return;
        };
        let brightness = self.brightness.poll();
        let cct = self.cct.poll(self.brightness.session());
        self.report_change(Control::Brightness, brightness.is_some());
        self.report_change(Control::Cct, cct.is_some());
        self.after_read();

        // the runtime may drop a write made in standby
        if let Some(percentage) = written
            .brightness
            .filter(|percentage| self.brightness.snapshot().percentage != Some(*percentage))
        {
            let _ = self.set_brightness(percentage, None);
        }
        // a set writes nothing when the gains already match
        if let Some(kelvin) = written.cct {
            let _ = self.set_cct(kelvin, None);
        }
    }

    /// Replaces the brightness fade and writes. `cause` gets a reply instead of the snapshot.
    fn set_brightness(&mut self, percentage: f64, cause: Option<u64>) -> Result<f64, SetError> {
        self.end_fade(Control::Brightness, Outcome::Superseded);
        let outcome = self.brightness.set(percentage);
        self.report_change(Control::Brightness, outcome.before.is_some());
        self.after_read();
        if let Some(snapshot) = outcome.after {
            self.events.push(Event::Brightness { snapshot, cause });
        }
        if let (Ok(applied), Some(written)) = (outcome.result, self.standby.as_mut()) {
            written.brightness = Some(applied);
        }
        outcome.result
    }

    /// Replaces the CCT fade and writes. `cause` gets a reply instead of the snapshot.
    fn set_cct(&mut self, kelvin: i64, cause: Option<u64>) -> Result<cct::Snapshot, cct::SetError> {
        self.end_fade(Control::Cct, Outcome::Superseded);
        let outcome = self.cct.set(self.brightness.session(), kelvin);
        self.report_change(Control::Cct, outcome.before.is_some());
        self.after_read();
        if let Some(snapshot) = outcome.after {
            self.events.push(Event::Cct { snapshot, cause });
        }
        if let (Ok(_), Some(written)) = (&outcome.result, self.standby.as_mut()) {
            written.cct = Some(kelvin);
        }
        outcome.result
    }

    /// Accepts a fade. `Ok(true)` means it completed at once: in standby, where nobody sees the
    /// display, and for a zero duration.
    fn start_fade(&mut self, request: FadeRequest) -> Result<bool, FadeError> {
        self.read_standby();
        let control = request.control;
        if self.standby.is_some() || request.duration.is_zero() {
            match control {
                Control::Brightness => self.set_brightness(request.target, None).map(drop)?,
                Control::Cct => self
                    .set_cct(request.target.round() as i64, None)
                    .map(drop)?,
            }
            return Ok(true);
        }

        // read the value the fade starts from
        let from = match control {
            Control::Brightness => {
                let changed = self.brightness.poll().is_some();
                self.report_change(control, changed);
                self.after_read();
                let snapshot = self.brightness.snapshot();
                if !snapshot.runtime {
                    return Err(FadeError::RuntimeUnavailable);
                }
                snapshot.percentage.ok_or(FadeError::Unsupported)?
            }
            Control::Cct => {
                let changed = self.cct.poll(self.brightness.session()).is_some();
                self.report_change(control, changed);
                self.after_read();
                let kelvin = self.cct.snapshot().kelvin;
                f64::from(kelvin.ok_or(FadeError::RuntimeUnavailable)?)
            }
        };

        // replace the running fade
        self.end_fade(control, Outcome::Superseded);
        let now = self.now;
        self.fades[control as usize] = Some(Fade {
            operation: request.operation,
            from,
            target: request.target,
            simple: request.simple.filter(|_| control == Control::Brightness),
            start: now,
            duration: request.duration,
            next_step: now + STEP_INTERVAL,
            next_report: now + REPORT_INTERVAL,
        });
        Ok(false)
    }

    /// Writes one fade step unless its value equals the last write, and ends the fade when a read
    /// before the write finds standby, runtime loss, or a headset change.
    fn step(&mut self, control: Control) {
        let now = self.now;
        let Some(fade) = self.fade(control) else {
            return;
        };
        let (value, done) = fade.value(now, self.brightness.bounds());
        let holds = match control {
            Control::Brightness => self.brightness.holds(value),
            Control::Cct => self.cct.holds(value.round() as i64),
        };

        // read, then write
        if !holds {
            self.read_standby();
            if self.standby.is_some() {
                return;
            }
            let changed = match control {
                Control::Brightness => self.brightness.poll().is_some(),
                Control::Cct => self.cct.poll(self.brightness.session()).is_some(),
            };
            self.report_change(control, changed);
            self.after_read();
            if self.fade(control).is_none() {
                return;
            }
            let written = match control {
                Control::Brightness => self.brightness.write_after_read(value).is_ok(),
                Control::Cct => self
                    .cct
                    .write_after_read(self.brightness.session(), value.round() as i64)
                    .is_ok(),
            };
            if !written {
                self.end_fade(control, Outcome::RuntimeUnavailable);
                return;
            }
        }

        // finish, or schedule the next step and report
        if done {
            self.end_fade(control, Outcome::Completed);
            return;
        }
        let fade = self.fades[control as usize]
            .as_mut()
            .expect("checked above");
        let next = fade.next_step + STEP_INTERVAL;
        fade.next_step = if next <= now {
            now + STEP_INTERVAL
        } else {
            next
        };
        if fade.next_report <= now {
            fade.next_report = now + REPORT_INTERVAL;
            self.report(control, None);
        }
    }

    /// Reports the control's current value and then the outcome, when a fade runs.
    fn end_fade(&mut self, control: Control, outcome: Outcome) {
        let Some(fade) = self.fades[control as usize].take() else {
            return;
        };
        self.report(control, None);
        self.events.push(Event::FadeEnded {
            control,
            operation: fade.operation,
            outcome,
        });
    }

    fn report_change(&mut self, control: Control, changed: bool) {
        if changed {
            self.report(control, None);
        }
    }

    fn report(&mut self, control: Control, cause: Option<u64>) {
        self.events.push(match control {
            Control::Brightness => Event::Brightness {
                snapshot: self.brightness.snapshot().clone(),
                cause,
            },
            Control::Cct => Event::Cct {
                snapshot: self.cct.snapshot().clone(),
                cause,
            },
        });
    }
}

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};

use super::*;
use crate::{
    brightness::{gain_to_percentage, percentage_to_gain, Capability, RuntimeLost},
    color_temperature::kelvin_to_f32_gains,
    hub::slept,
};

struct Headset {
    running: bool,
    standby: bool,
    gain: f32,
    gains: [f32; 3],
    gain_writes: Vec<f32>,
    gains_writes: Vec<[f32; 3]>,
    /// Drops every write while in standby, as the runtime may.
    drops_standby_writes: bool,
}

#[derive(Clone)]
struct Fake(Arc<Mutex<Headset>>);

impl Fake {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(Headset {
            running: true,
            standby: false,
            gain: 1.0,
            gains: [1.0; 3],
            gain_writes: Vec::new(),
            gains_writes: Vec::new(),
            drops_standby_writes: false,
        })))
    }

    fn edit<T>(&self, change: impl FnOnce(&mut Headset) -> T) -> T {
        change(&mut self.0.lock().unwrap())
    }

    fn percentage_writes(&self) -> Vec<f64> {
        self.edit(|headset| {
            headset
                .gain_writes
                .iter()
                .map(|gain| (gain_to_percentage(*gain as f64) * 100.0).round() / 100.0)
                .collect()
        })
    }

    fn percentage(&self) -> f64 {
        self.edit(|headset| (gain_to_percentage(headset.gain as f64) * 100.0).round() / 100.0)
    }
}

impl Backend for Fake {
    fn connect(&mut self) -> bool {
        self.edit(|headset| headset.running)
    }

    fn disconnect(&mut self) {}

    fn capability(&mut self) -> Result<Capability, RuntimeLost> {
        self.edit(|headset| {
            headset
                .running
                .then_some(Capability {
                    supported: true,
                    min_gain: 0.005,
                    max_gain: 1.25,
                })
                .ok_or(RuntimeLost)
        })
    }

    fn gain(&mut self) -> Result<f32, RuntimeLost> {
        self.edit(|headset| headset.running.then_some(headset.gain).ok_or(RuntimeLost))
    }

    fn set_gain(&mut self, gain: f32) -> Result<(), RuntimeLost> {
        self.edit(|headset| {
            headset.gain_writes.push(gain);
            if !(headset.standby && headset.drops_standby_writes) {
                headset.gain = gain;
            }
            Ok(())
        })
    }

    fn standby(&mut self) -> Result<bool, RuntimeLost> {
        self.edit(|headset| {
            headset
                .running
                .then_some(headset.standby)
                .ok_or(RuntimeLost)
        })
    }
}

impl ColorGains for Fake {
    fn color_gains(&mut self) -> Result<[Option<f32>; 3], RuntimeLost> {
        self.edit(|headset| {
            headset
                .running
                .then_some(headset.gains.map(Some))
                .ok_or(RuntimeLost)
        })
    }

    fn set_color_gains(&mut self, gains: [f32; 3]) -> Result<(), RuntimeLost> {
        self.edit(|headset| {
            headset.gains_writes.push(gains);
            if !(headset.standby && headset.drops_standby_writes) {
                headset.gains = gains;
            }
            Ok(())
        })
    }
}

/// The controls on a fake headset at full brightness and 6600 K, after the first poll.
struct Rig {
    fake: Fake,
    controls: Controls<Fake>,
    start: Instant,
    now: Instant,
}

impl Rig {
    fn new() -> Self {
        let fake = Fake::new();
        let start = Instant::now();
        let mut controls = Controls::new(fake.clone(), start);
        controls.tick(start, false);
        controls.take_events();
        Self {
            fake,
            controls,
            start,
            now: start,
        }
    }

    fn at(&self, ms: u64) -> Instant {
        self.start + Duration::from_millis(ms)
    }

    fn send(&mut self, connection: u64, action: Action) -> Vec<Event> {
        self.controls.command(
            Command {
                connection,
                id: 1,
                action,
            },
            self.now,
        );
        self.controls.take_events()
    }

    fn fade(&mut self, control: Control, operation: &str, target: f64, ms: u64) -> Vec<Event> {
        self.send(
            1,
            Action::Fade(FadeRequest {
                control,
                operation: operation.into(),
                target,
                duration: Duration::from_millis(ms),
                simple: None,
            }),
        )
    }

    /// Runs every tick due up to `ms` after the start, and returns their events.
    fn run_until(&mut self, ms: u64) -> Vec<Event> {
        let end = self.at(ms);
        let mut events = Vec::new();
        loop {
            let wake = self.controls.next_wake();
            if wake > end {
                break;
            }
            self.now = wake;
            self.controls.tick(wake, false);
            events.extend(self.controls.take_events());
        }
        self.now = end;
        events
    }
}

fn ended(events: &[Event]) -> Vec<(Control, String, Outcome)> {
    events
        .iter()
        .filter_map(|event| match event {
            Event::FadeEnded {
                control,
                operation,
                outcome,
            } => Some((*control, operation.clone(), *outcome)),
            _ => None,
        })
        .collect()
}

fn ended_one(
    control: Control,
    operation: &str,
    outcome: Outcome,
) -> Vec<(Control, String, Outcome)> {
    vec![(control, operation.into(), outcome)]
}

fn fade_reply(events: &[Event]) -> Option<Result<(), FadeError>> {
    events.iter().find_map(|event| match event {
        Event::FadeReply { result, .. } => Some(*result),
        _ => None,
    })
}

fn gain_of(percentage: f64) -> f32 {
    percentage_to_gain(percentage) as f32
}

#[test]
fn eases_at_60_hz_and_ends_on_the_target() {
    let mut rig = Rig::new();
    let events = rig.fade(Control::Brightness, "a", 50.0, 1000);
    assert_eq!(fade_reply(&events), Some(Ok(())));
    let events = rig.run_until(1100);
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "a", Outcome::Completed)
    );

    // one write per 60 Hz step, the last one the target
    let writes = rig.fake.percentage_writes();
    assert!((59..=61).contains(&writes.len()), "{}", writes.len());
    assert_eq!(*writes.last().unwrap(), 50.0);
    assert!(writes.windows(2).all(|pair| pair[1] <= pair[0]));

    // smoothstep: slow at both ends, halfway at half time
    let middle = writes[writes.len() / 2 - 1];
    assert!((middle - 75.0).abs() < 2.0, "{middle}");
    assert!(100.0 - writes[0] < 0.2, "{}", writes[0]);
}

#[test]
fn skips_steps_that_write_the_same_gain() {
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 100.0, 1000);
    let events = rig.run_until(1100);
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "a", Outcome::Completed)
    );
    assert!(rig.fake.percentage_writes().is_empty());
    // the same for color temperature, where every step rounds to 6600 K
    rig.fade(Control::Cct, "b", 6600.4, 1000);
    let events = rig.run_until(2200);
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "b", Outcome::Completed)
    );
    assert!(rig.fake.edit(|headset| headset.gains_writes.is_empty()));
}

#[test]
fn fades_color_temperature_in_kelvin_steps() {
    let mut rig = Rig::new();
    rig.fade(Control::Cct, "a", 3000.0, 500);
    let events = rig.run_until(600);
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "a", Outcome::Completed)
    );
    let writes = rig.fake.edit(|headset| headset.gains_writes.clone());
    assert!(writes.len() > 20, "{}", writes.len());
    assert_eq!(*writes.last().unwrap(), kelvin_to_f32_gains(3000));
}

#[test]
fn reports_progress_at_most_every_250_ms() {
    let mut rig = Rig::new();
    let accepted = rig.fade(Control::Brightness, "a", 50.0, 1000);
    let events = rig.run_until(1100);
    let reports: Vec<_> = accepted
        .iter()
        .chain(&events)
        .filter_map(|event| match event {
            Event::Brightness {
                fade: Some(fade), ..
            } => Some(fade.clone()),
            _ => None,
        })
        .collect();
    assert!((4..=5).contains(&reports.len()), "{reports:?}");
    assert_eq!(reports[0].remaining_ms, 1000);
    assert!(reports
        .iter()
        .all(|fade| fade.operation == "a" && fade.target == 50.0));
    // the snapshot before the outcome carries no fade
    let last_snapshot = events
        .iter()
        .rev()
        .find_map(|event| match event {
            Event::Brightness { snapshot, fade, .. } => Some((snapshot.percentage, fade.clone())),
            _ => None,
        })
        .unwrap();
    assert_eq!(last_snapshot, (Some(50.0), None));
}

#[test]
fn maps_the_simple_curve_through_the_floor_both_ways() {
    assert_eq!(simple_to_hardware(5.0, 9.0, 125.0), 9.0);
    assert_eq!(simple_to_hardware(100.0, 9.0, 125.0), 125.0);
    assert!((simple_to_hardware(54.5, 9.0, 125.0) - 67.0).abs() < 1e-9);

    // down: hardware reaches the floor early and stays there, the fade runs to its end
    let mut rig = Rig::new();
    let simple = |from: f64, to: f64, target: f64, operation: &str| {
        Action::Fade(FadeRequest {
            control: Control::Brightness,
            operation: operation.into(),
            target,
            duration: Duration::from_millis(1000),
            simple: Some((from, to)),
        })
    };
    rig.send(1, simple(100.0, 0.0, 9.0, "down"));
    let events = rig.run_until(990);
    assert!(ended(&events).is_empty());
    let writes = rig.fake.percentage_writes();
    assert_eq!(*writes.last().unwrap(), 9.0);
    let first_floor = writes.iter().position(|w| *w == 9.0).unwrap();
    assert_eq!(first_floor, writes.len() - 1, "one write reaches the floor");
    assert!(
        writes.len() < 50,
        "steps at the floor are skipped: {}",
        writes.len()
    );
    let events = rig.run_until(1100);
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "down", Outcome::Completed)
    );

    // up: hardware stays at the floor until the simple value passes it
    rig.fake.edit(|headset| headset.gain_writes.clear());
    rig.send(1, simple(0.0, 100.0, 125.0, "up"));
    // the fade started at 1100 ms and passes 9% simple at about 1280 ms
    rig.run_until(1250);
    assert!(
        rig.fake.percentage_writes().is_empty(),
        "still below the floor"
    );
    let events = rig.run_until(2200);
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "up", Outcome::Completed)
    );
    assert_eq!(*rig.fake.percentage_writes().last().unwrap(), 125.0);
}

#[test]
fn another_pcs_set_or_fade_supersedes_a_fade() {
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 50.0, 1000);
    rig.run_until(300);
    let events = rig.send(2, Action::SetBrightness(80.0));
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "a", Outcome::Superseded)
    );
    assert_eq!(rig.fake.percentage(), 80.0);

    rig.fade(Control::Cct, "b", 3000.0, 1000);
    rig.run_until(600);
    let events = rig.send(
        2,
        Action::Fade(FadeRequest {
            control: Control::Cct,
            operation: "c".into(),
            target: 5000.0,
            duration: Duration::from_millis(500),
            simple: None,
        }),
    );
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "b", Outcome::Superseded)
    );
    let events = rig.run_until(1200);
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "c", Outcome::Completed)
    );
}

#[test]
fn cancels_only_the_named_operation() {
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 50.0, 1000);
    rig.fade(Control::Cct, "b", 3000.0, 1000);
    rig.run_until(200);
    assert!(ended(&rig.send(1, Action::CancelFade("stale".into()))).is_empty());
    let events = rig.send(2, Action::CancelFade("a".into()));
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "a", Outcome::Cancelled)
    );
    let events = rig.run_until(1100);
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "b", Outcome::Completed)
    );
}

#[test]
fn a_command_for_one_control_leaves_the_other_fade_alone() {
    let mut rig = Rig::new();
    rig.fade(Control::Cct, "cct", 3000.0, 1000);
    rig.run_until(200);
    assert!(ended(&rig.send(1, Action::SetBrightness(60.0))).is_empty());
    assert!(ended(&rig.fade(Control::Brightness, "brightness", 40.0, 500)).is_empty());
    rig.run_until(400);
    assert!(ended(&rig.send(1, Action::SetCct(4000))).len() == 1);
    let events = rig.run_until(1100);
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "brightness", Outcome::Completed)
    );
}

#[test]
fn a_headset_change_cancels_only_that_controls_fade() {
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 50.0, 1000);
    rig.fade(Control::Cct, "b", 3000.0, 1000);
    rig.run_until(300);
    rig.fake.edit(|headset| headset.gain = gain_of(110.0));
    let events = rig.run_until(320);
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "a", Outcome::ExternalChange)
    );
    assert_eq!(
        rig.fake.percentage(),
        110.0,
        "the helper does not write over it"
    );
    let writes = rig.fake.percentage_writes().len();
    rig.run_until(600);
    assert_eq!(rig.fake.percentage_writes().len(), writes);

    // a change to one of the three gains is a change
    rig.fake.edit(|headset| headset.gains[1] = 0.3);
    let events = rig.run_until(620);
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "b", Outcome::ExternalChange)
    );
}

#[test]
fn standby_cancels_both_fades_and_wake_writes_nothing_new() {
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 50.0, 1000);
    rig.fade(Control::Cct, "b", 3000.0, 1000);
    rig.run_until(300);
    rig.fake.edit(|headset| headset.standby = true);
    let events = rig.run_until(320);
    assert_eq!(
        ended(&events),
        vec![
            (Control::Brightness, "a".into(), Outcome::Standby),
            (Control::Cct, "b".into(), Outcome::Standby),
        ]
    );
    let writes = rig.fake.percentage_writes().len();
    rig.fake.edit(|headset| headset.standby = false);
    rig.run_until(2000);
    assert_eq!(
        rig.fake.percentage_writes().len(),
        writes,
        "no fade resumes"
    );
}

#[test]
fn a_suspend_counts_as_standby() {
    assert!(slept(
        Duration::from_millis(250),
        Duration::from_millis(1300)
    ));
    assert!(!slept(
        Duration::from_millis(250),
        Duration::from_millis(1200)
    ));
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 50.0, 1000);
    rig.controls.tick(rig.at(400), true);
    let events = rig.controls.take_events();
    assert_eq!(
        ended(&events),
        ended_one(Control::Brightness, "a", Outcome::Standby)
    );
}

#[test]
fn commands_in_standby_are_written_and_a_fade_becomes_a_set() {
    let mut rig = Rig::new();
    rig.fake.edit(|headset| headset.standby = true);
    rig.run_until(300);
    let events = rig.send(1, Action::SetBrightness(70.0));
    assert!(matches!(
        events.last(),
        Some(Event::BrightnessReply {
            result: Ok(70.0),
            ..
        })
    ));
    let events = rig.fade(Control::Cct, "a", 2500.0, 60_000);
    assert_eq!(fade_reply(&events), Some(Ok(())));
    assert_eq!(
        ended(&events),
        ended_one(Control::Cct, "a", Outcome::Completed)
    );
    assert_eq!(
        rig.fake.edit(|headset| headset.gains),
        kelvin_to_f32_gains(2500)
    );
}

#[test]
fn wake_rewrites_a_lost_standby_write_once() {
    let mut rig = Rig::new();
    rig.fake.edit(|headset| {
        headset.standby = true;
        headset.drops_standby_writes = true;
    });
    rig.run_until(300);
    rig.send(1, Action::SetBrightness(40.0));
    rig.send(1, Action::SetCct(3000));
    assert_eq!(rig.fake.percentage(), 100.0);
    rig.fake.edit(|headset| {
        headset.standby = false;
        headset.gain_writes.clear();
        headset.gains_writes.clear();
    });
    rig.run_until(600);
    assert_eq!(rig.fake.percentage_writes(), [40.0]);
    assert_eq!(
        rig.fake.edit(|headset| headset.gains_writes.clone()),
        [kelvin_to_f32_gains(3000)]
    );
    rig.run_until(2000);
    assert_eq!(rig.fake.percentage_writes().len(), 1);
}

#[test]
fn wake_writes_nothing_when_the_standby_write_held() {
    let mut rig = Rig::new();
    rig.fake.edit(|headset| headset.standby = true);
    rig.run_until(300);
    rig.send(1, Action::SetBrightness(40.0));
    rig.send(1, Action::SetCct(3000));
    rig.fake.edit(|headset| {
        headset.standby = false;
        headset.gain_writes.clear();
        headset.gains_writes.clear();
    });
    rig.run_until(2000);
    assert!(rig.fake.percentage_writes().is_empty());
    assert!(rig.fake.edit(|headset| headset.gains_writes.is_empty()));
}

#[test]
fn runtime_loss_cancels_both_fades() {
    let mut rig = Rig::new();
    rig.fade(Control::Brightness, "a", 50.0, 1000);
    rig.fade(Control::Cct, "b", 3000.0, 1000);
    rig.run_until(300);
    rig.fake.edit(|headset| headset.running = false);
    let events = rig.run_until(320);
    assert_eq!(
        ended(&events),
        vec![
            (Control::Brightness, "a".into(), Outcome::RuntimeUnavailable),
            (Control::Cct, "b".into(), Outcome::RuntimeUnavailable),
        ]
    );
    // the return reads without writing
    let writes = rig.fake.percentage_writes().len();
    rig.fake.edit(|headset| headset.running = true);
    rig.run_until(3000);
    assert_eq!(rig.fake.percentage_writes().len(), writes);
    assert_eq!(
        fade_reply(&rig.fade(Control::Brightness, "c", 50.0, 1000)),
        Some(Ok(()))
    );
}

#[test]
fn refuses_fades_it_cannot_run() {
    let mut rig = Rig::new();
    rig.fake.edit(|headset| headset.running = false);
    rig.run_until(300);
    assert_eq!(
        fade_reply(&rig.fade(Control::Brightness, "a", 50.0, 1000)),
        Some(Err(FadeError::RuntimeUnavailable))
    );
    assert_eq!(
        fade_reply(&rig.fade(Control::Cct, "b", 3000.0, 1000)),
        Some(Err(FadeError::RuntimeUnavailable))
    );
}

fn hold_reply(events: &[Event]) -> Option<bool> {
    events.iter().find_map(|event| match event {
        Event::MaintenanceReply { held, .. } => Some(*held),
        _ => None,
    })
}

#[test]
fn a_maintenance_hold_refuses_fades_and_allows_sets() {
    let mut rig = Rig::new();

    // busy while a fade runs
    rig.fade(Control::Brightness, "a", 50.0, 500);
    assert_eq!(
        hold_reply(&rig.send(2, Action::BeginMaintenance)),
        Some(false)
    );
    rig.run_until(600);

    // held: fades refused, sets work
    let events = rig.send(2, Action::BeginMaintenance);
    assert_eq!(hold_reply(&events), Some(true));
    assert!(events.contains(&Event::Hold(true)));
    assert_eq!(
        fade_reply(&rig.fade(Control::Cct, "b", 3000.0, 1000)),
        Some(Err(FadeError::Maintenance))
    );
    rig.send(1, Action::SetBrightness(70.0));
    assert_eq!(rig.fake.percentage(), 70.0);

    // the end message lifts it
    let events = rig.send(2, Action::EndMaintenance);
    assert_eq!(events, [Event::Hold(false)]);
    assert_eq!(
        fade_reply(&rig.fade(Control::Cct, "c", 3000.0, 1000)),
        Some(Ok(()))
    );
}

#[test]
fn a_maintenance_hold_belongs_to_the_connection_that_took_it() {
    let mut rig = Rig::new();
    assert_eq!(
        hold_reply(&rig.send(2, Action::BeginMaintenance)),
        Some(true)
    );

    // another PC can neither take the hold nor end it
    assert_eq!(
        hold_reply(&rig.send(3, Action::BeginMaintenance)),
        Some(false)
    );
    assert_eq!(rig.send(3, Action::EndMaintenance), []);
    assert_eq!(
        fade_reply(&rig.fade(Control::Cct, "a", 3000.0, 1000)),
        Some(Err(FadeError::Maintenance))
    );

    // the owner renews it without a second notice, and ends it
    assert!(!rig
        .send(2, Action::BeginMaintenance)
        .contains(&Event::Hold(true)));
    assert_eq!(rig.send(2, Action::EndMaintenance), [Event::Hold(false)]);
}

#[test]
fn a_maintenance_hold_ends_after_120_s() {
    let mut rig = Rig::new();
    rig.send(2, Action::BeginMaintenance);
    let events = rig.run_until(119_900);
    assert!(!events.contains(&Event::Hold(false)));
    let events = rig.run_until(120_100);
    assert!(events.contains(&Event::Hold(false)));
    assert_eq!(
        fade_reply(&rig.fade(Control::Brightness, "a", 50.0, 1000)),
        Some(Ok(()))
    );
}

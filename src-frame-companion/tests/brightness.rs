use oyasumivr_frame_companion::brightness::{BrightnessController, BrightnessHardware};
use oyasumivr_frame_protocol::*;
struct Hardware {
    bounds: GainBounds,
    gain: f64,
    ready: bool,
    fail: bool,
    readback: Option<(f64, bool)>,
    writes: Vec<f64>,
}
impl BrightnessHardware for Hardware {
    fn read(&mut self) -> Result<(GainBounds, f64, bool), BrightnessError> {
        Ok((self.bounds, self.gain, self.ready))
    }
    fn write(&mut self, gain: f64) -> Result<(), BrightnessError> {
        if self.fail {
            return Err(BrightnessError::WriteFailed);
        }
        self.gain = gain;
        if let Some((actual, ready)) = self.readback {
            self.gain = actual;
            self.ready = ready;
        }
        self.writes.push(gain);
        Ok(())
    }
}
fn setup() -> (BrightnessController, Hardware) {
    let mut controller = BrightnessController::default();
    let mut hardware = Hardware {
        bounds: GainBounds {
            min: 0.005,
            max: 1.25,
        },
        gain: 1.0,
        ready: true,
        fail: false,
        readback: None,
        writes: vec![],
    };
    controller.tick(&mut hardware, 0);
    (controller, hardware)
}
fn transition(id: &str, target: f64, duration: u64) -> Command {
    Command::TransitionBrightness {
        operation_id: id.into(),
        percentage: target,
        duration_ms: duration,
        simple: None,
    }
}
fn accepted(reply: ReplyResult) {
    assert!(matches!(reply, ReplyResult::Brightness { .. }));
}
#[test]
fn conversion_and_easing_match_measured_fixtures() {
    for (percent, gain) in [
        (9.0, 0.005004187),
        (50.0, 0.217637628),
        (100.0, 1.0),
        (125.0, 1.25),
    ] {
        assert!((percentage_to_gain(percent) - gain).abs() < 0.000001);
        assert!((gain_to_percentage(gain) - percent).abs() < 0.00001);
    }
    let (mut c, mut h) = setup();
    accepted(c.command(transition("a", 20.0, 1000), 0));
    assert_eq!(c.state.applied, Some(100.0));
    assert_eq!(c.state.phase, BrightnessPhase::Accepted);
    c.tick(&mut h, 250);
    assert!((c.state.applied.unwrap() - 87.5).abs() < 0.000001);
    c.tick(&mut h, 1000);
    assert_eq!(c.state.phase, BrightnessPhase::Completed);
    assert!((c.state.applied.unwrap() - 20.0).abs() < 0.000001);
}
#[test]
fn replacements_stale_cancellation_and_write_failure() {
    let (mut c, mut h) = setup();
    accepted(c.command(transition("a", 20.0, 1000), 0));
    c.tick(&mut h, 100);
    accepted(c.command(transition("b", 120.0, 1000), 100));
    assert!(matches!(
        c.command(
            Command::CancelBrightness {
                operation_id: "a".into()
            },
            100
        ),
        ReplyResult::BrightnessError {
            code: BrightnessError::StaleOperation
        }
    ));
    let applied = c.state.applied;
    h.fail = true;
    c.tick(&mut h, 200);
    assert_eq!(c.state.applied, applied);
    assert_eq!(c.state.phase, BrightnessPhase::Failed);
    assert_eq!(c.state.error, Some(BrightnessError::WriteFailed));
    h.fail = false;
    c.tick(&mut h, 2000);
    assert_eq!(c.state.applied, applied);
    accepted(c.command(transition("c", 100.0, 1000), 2000));
    accepted(c.command(
        Command::CancelBrightness {
            operation_id: "c".into(),
        },
        2100,
    ));
    c.tick(&mut h, 5000);
    assert_eq!(c.state.phase, BrightnessPhase::Cancelled);
    assert_eq!(c.state.applied, applied);
}
#[test]
fn standby_keeps_latest_target_but_daemon_restart_reads_actual() {
    let (mut c, mut h) = setup();
    h.ready = false;
    c.tick(&mut h, 0);
    accepted(c.command(transition("a", 20.0, 100), 0));
    accepted(c.command(transition("b", 70.0, 100), 10));
    c.tick(&mut h, 1000);
    assert!(h.writes.is_empty());
    h.ready = true;
    c.tick(&mut h, 1010);
    assert_eq!(c.state.phase, BrightnessPhase::Completed);
    assert!((c.state.applied.unwrap() - 70.0).abs() < 0.000001);
    let mut restarted = BrightnessController::default();
    restarted.tick(&mut h, 0);
    assert_eq!(restarted.state.operation_id, None);
    assert_eq!(h.writes.len(), 1);
    assert_eq!(restarted.state.applied, c.state.applied);
}
#[test]
fn invalid_commands_do_not_replace_active_work() {
    let (mut c, _) = setup();
    accepted(c.command(transition("a", 20.0, 1000), 0));
    for target in [0.0, 1.0, 8.0, 126.0, 140.0, f64::NAN] {
        assert!(matches!(
            c.command(transition("b", target, 1000), 0),
            ReplyResult::BrightnessError {
                code: BrightnessError::InvalidTarget
            }
        ));
    }
    assert_eq!(c.state.operation_id.as_deref(), Some("a"));
}
#[test]
fn simple_curve_preserves_floor_crossing_in_both_directions() {
    for (from, to) in [(80.0, 0.0), (0.0, 80.0)] {
        let (mut c, mut h) = setup();
        let bounds = c.state.bounds.unwrap();
        accepted(c.command(
            Command::TransitionBrightness {
                operation_id: "a".into(),
                percentage: simple_hardware(to, bounds),
                duration_ms: 1000,
                simple: Some(SimpleCurve { from, to }),
            },
            0,
        ));
        for time in (0..=1000).step_by(10) {
            c.tick(&mut h, time);
            let simple = from + (to - from) * ease(time as f64 / 1000.0);
            assert!((c.state.applied.unwrap() - simple_hardware(simple, bounds)).abs() < 0.000001);
            assert!(h.gain >= bounds.min && h.gain <= bounds.max);
        }
        assert_eq!(c.state.phase, BrightnessPhase::Completed);
    }
}

#[test]
fn readback_reports_actual_even_when_write_is_not_completed() {
    for ready in [true, false] {
        let (mut controller, mut hardware) = setup();
        hardware.readback = Some((0.3, ready));
        accepted(controller.command(transition("readback", 20.0, 0), 0));
        controller.tick(&mut hardware, 1);
        assert_eq!(controller.state.applied, Some(gain_to_percentage(0.3)));
        assert_eq!(
            controller.state.phase,
            if ready {
                BrightnessPhase::Failed
            } else {
                BrightnessPhase::Deferred
            }
        );
        assert_eq!(controller.state.progress, 0.0);
    }
}

#[test]
fn enforces_reported_bounds_and_rejects_nonfinite_capabilities() {
    let (mut controller, mut hardware) = setup();
    hardware.bounds = GainBounds { min: 0.1, max: 0.8 };
    controller.tick(&mut hardware, 1);
    assert_eq!(controller.state.bounds, Some(hardware.bounds));
    assert!(matches!(
        controller.command(transition("outside", 100.0, 0), 1),
        ReplyResult::BrightnessError {
            code: BrightnessError::InvalidTarget
        }
    ));
    accepted(controller.command(transition("inside", 50.0, 0), 1));
    controller.tick(&mut hardware, 2);
    assert!(hardware.gain >= 0.1 && hardware.gain <= 0.8);
    for bounds in [
        GainBounds {
            min: 0.1,
            max: f64::NAN,
        },
        GainBounds { min: 0.0, max: 1.0 },
        GainBounds { min: 0.8, max: 0.1 },
    ] {
        hardware.bounds = bounds;
        controller.tick(&mut hardware, 3);
        assert!(!controller.state.ready);
        assert_eq!(controller.state.error, Some(BrightnessError::InvalidBounds));
    }
}

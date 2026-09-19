use oyasumivr_frame_protocol::*;

pub trait BrightnessHardware {
    fn read(&mut self) -> Result<(GainBounds, f64, bool), BrightnessError>;
    fn write(&mut self, gain: f64) -> Result<(), BrightnessError>;
}

struct Transition {
    from: f64,
    target: f64,
    start_ms: u64,
    duration_ms: u64,
    simple: Option<SimpleCurve>,
}

#[derive(Default)]
pub struct BrightnessController {
    pub state: BrightnessState,
    transition: Option<Transition>,
}

impl BrightnessController {
    pub fn command(&mut self, command: Command, now_ms: u64) -> ReplyResult {
        match self.accept(command, now_ms) {
            Ok(()) => ReplyResult::Brightness {
                state: self.state.clone(),
            },
            Err(code) => ReplyResult::BrightnessError { code },
        }
    }

    fn accept(&mut self, command: Command, now_ms: u64) -> Result<(), BrightnessError> {
        let (id, target, duration_ms, simple) = match command {
            Command::GetBrightness => return Ok(()),
            Command::CancelBrightness { operation_id } => {
                if self.state.operation_id.as_ref() != Some(&operation_id) {
                    return Err(BrightnessError::StaleOperation);
                }
                if self.transition.take().is_some() {
                    self.state.phase = BrightnessPhase::Cancelled;
                    self.state.revision += 1;
                }
                return Ok(());
            }
            Command::SetBrightness {
                operation_id,
                percentage,
            } => (operation_id, percentage, 0, None),
            Command::TransitionBrightness {
                operation_id,
                percentage,
                duration_ms,
                simple,
            } => (operation_id, percentage, duration_ms, simple),
            _ => return Err(BrightnessError::Unsupported),
        };
        if id.is_empty() || id.len() > 64 || id.chars().any(char::is_control) {
            return Err(BrightnessError::InvalidTarget);
        }
        if self.state.operation_id.as_ref() == Some(&id) {
            return Err(BrightnessError::StaleOperation);
        }
        let bounds = self.state.bounds.ok_or(BrightnessError::NotReady)?;
        let [min, max] = bounds.percentages();
        if !target.is_finite() || target < min - 0.000001 || target > max + 0.000001 {
            return Err(BrightnessError::InvalidTarget);
        }
        if duration_ms > 86_400_000 {
            return Err(BrightnessError::InvalidDuration);
        }
        if let Some(curve) = simple {
            if min >= 100.0
                || !curve.from.is_finite()
                || !curve.to.is_finite()
                || !(0.0..=100.0).contains(&curve.from)
                || !(0.0..=100.0).contains(&curve.to)
                || (simple_hardware(curve.to, bounds) - target).abs() > 0.0001
            {
                return Err(BrightnessError::InvalidTarget);
            }
        }
        let from = self.state.applied.ok_or(BrightnessError::NotReady)?;
        self.transition = Some(Transition {
            from,
            target,
            start_ms: now_ms,
            duration_ms,
            simple,
        });
        self.state.operation_id = Some(id);
        self.state.requested = Some(target);
        self.state.accepted = Some(target);
        self.state.phase = if self.state.ready {
            BrightnessPhase::Accepted
        } else {
            BrightnessPhase::Deferred
        };
        self.state.progress = 0.0;
        self.state.elapsed_ms = 0;
        self.state.error = None;
        self.state.revision += 1;
        Ok(())
    }

    pub fn unavailable(&mut self) {
        if self.state.ready {
            self.state.ready = false;
            self.state.revision += 1;
        }
        if self.transition.is_some() {
            self.state.phase = BrightnessPhase::Deferred;
        }
    }

    pub fn tick(&mut self, hardware: &mut impl BrightnessHardware, now_ms: u64) {
        let before = self.state.clone();
        self.step(hardware, now_ms);
        if self.state != before {
            self.state.revision = before.revision + 1;
        }
    }

    fn step(&mut self, hardware: &mut impl BrightnessHardware, now_ms: u64) {
        let (mut bounds, gain, display_ready) = match hardware.read() {
            Ok(value) => value,
            Err(error) => {
                self.unavailable();
                self.state.error = Some(error);
                return;
            }
        };
        if !bounds.valid() {
            self.unavailable();
            self.state.error = Some(BrightnessError::InvalidBounds);
            return;
        }
        bounds.max = bounds.max.min(1.25);
        if !bounds.valid() || !gain.is_finite() || gain <= 0.0 {
            self.unavailable();
            self.state.error = Some(BrightnessError::InvalidBounds);
            return;
        }
        if matches!(
            self.state.error,
            Some(BrightnessError::ReadFailed | BrightnessError::InvalidBounds)
        ) {
            self.state.error = None;
        }
        self.state.bounds = Some(bounds);
        self.state.ready = display_ready;
        self.state.applied = Some(gain_to_percentage(gain));
        let Some(transition) = self.transition.as_ref() else {
            return;
        };
        if !display_ready {
            self.state.phase = BrightnessPhase::Deferred;
            return;
        }
        let elapsed = now_ms.saturating_sub(transition.start_ms);
        let progress = if transition.duration_ms == 0 {
            1.0
        } else {
            (elapsed as f64 / transition.duration_ms as f64).min(1.0)
        };
        let percentage = if let Some(curve) = transition.simple {
            simple_hardware(
                curve.from + (curve.to - curve.from) * ease(progress),
                bounds,
            )
        } else {
            transition.from + (transition.target - transition.from) * ease(progress)
        };
        let [min, max] = bounds.percentages();
        if transition.target < min - 0.000001 || transition.target > max + 0.000001 {
            self.fail(BrightnessError::InvalidTarget);
            return;
        }
        let next_gain = percentage_to_gain(percentage).clamp(bounds.min, bounds.max);
        if let Err(error) = hardware.write(next_gain) {
            self.fail(error);
            return;
        }
        match hardware.read() {
            Ok((_, applied, display_ready)) if applied.is_finite() && applied > 0.0 => {
                self.state.applied = Some(gain_to_percentage(applied));
                if !display_ready {
                    self.unavailable();
                    return;
                }
                if (applied - next_gain).abs() > 0.00001 {
                    self.fail(BrightnessError::WriteFailed);
                    return;
                }
                self.state.progress = progress;
                self.state.elapsed_ms = elapsed.min(transition.duration_ms);
                self.state.error = None;
                self.state.phase = if progress == 1.0 {
                    BrightnessPhase::Completed
                } else {
                    BrightnessPhase::Running
                };
                if progress == 1.0 {
                    self.transition = None;
                }
            }
            _ => self.fail(BrightnessError::WriteFailed),
        }
    }

    fn fail(&mut self, error: BrightnessError) {
        self.transition = None;
        self.state.phase = BrightnessPhase::Failed;
        self.state.error = Some(error);
    }
}

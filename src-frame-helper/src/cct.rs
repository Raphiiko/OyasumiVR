use serde::Serialize;

use crate::{
    brightness::{OpenVr, RuntimeLost},
    color_temperature::{
        gains_equal, gains_to_kelvin, kelvin_to_f32_gains, MAX_KELVIN, MIN_KELVIN,
    },
};

/// An unset gain key means SteamVR applies no tint on that channel.
const UNSET_GAIN: f32 = 1.0;

pub trait ColorGains {
    /// The red, green, and blue `hmdDisplayColorGain` settings; `None` for an unset key.
    fn color_gains(&mut self) -> Result<[Option<f32>; 3], RuntimeLost>;
    /// Writes the three channels in order, so a failure can leave some of them written.
    fn set_color_gains(&mut self, gains: [f32; 3]) -> Result<(), RuntimeLost>;
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// False while no SteamVR session is open; nothing else is known then.
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gains: Option<[f32; 3]>,
    /// The nearest integer Kelvin on OyasumiVR's curve.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kelvin: Option<u32>,
    /// True when the gains lie on the curve at `kelvin`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exact: Option<bool>,
}

impl Snapshot {
    pub const UNAVAILABLE: Self = Self {
        available: false,
        gains: None,
        kelvin: None,
        exact: None,
    };

    fn of(gains: [f32; 3]) -> Self {
        let (kelvin, exact) = gains_to_kelvin(gains);
        Self {
            available: true,
            gains: Some(gains),
            kelvin: Some(kelvin),
            exact: Some(exact),
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SetError {
    RuntimeUnavailable,
    WriteFailed,
}

#[derive(Debug, PartialEq)]
pub struct SetOutcome {
    /// A change made elsewhere, found by the read before the write.
    pub before: Option<Snapshot>,
    pub result: Result<Snapshot, SetError>,
    /// The state after a write that changed the gains.
    pub after: Option<Snapshot>,
}

/// Tracks the headset's color gains. Only `set` writes; `poll` only reads.
pub struct Cct {
    /// The last gains read or written, which a later read is compared with.
    last: Option<[f32; 3]>,
    snapshot: Snapshot,
}

impl Default for Cct {
    fn default() -> Self {
        Self {
            last: None,
            snapshot: Snapshot::UNAVAILABLE,
        }
    }
}

impl Cct {
    pub fn snapshot(&self) -> &Snapshot {
        &self.snapshot
    }

    /// Reads the headset through the open session, or `None` without one, and returns a new
    /// snapshot when anything changed since the last read or write.
    pub fn poll(&mut self, session: Option<&mut impl ColorGains>) -> Option<Snapshot> {
        match session.map(read) {
            Some(Ok(gains)) => {
                if !self.last.is_some_and(|last| gains_equal(last, gains)) {
                    self.last = Some(gains);
                }
            }
            None | Some(Err(RuntimeLost)) => self.last = None,
        }
        self.publish()
    }

    /// Reads first, so a change made elsewhere is reported before this write replaces it. Writes
    /// nothing when the gains already match.
    pub fn set(&mut self, mut session: Option<&mut impl ColorGains>, kelvin: i64) -> SetOutcome {
        let before = self.poll(session.as_deref_mut());
        let result = self.write(session, kelvin);
        let after = result.is_ok().then(|| self.publish()).flatten();
        SetOutcome {
            before,
            result: result.map(|()| self.snapshot.clone()),
            after,
        }
    }

    fn write(
        &mut self,
        session: Option<&mut impl ColorGains>,
        kelvin: i64,
    ) -> Result<(), SetError> {
        let (Some(session), Some(last)) = (session, self.last) else {
            return Err(SetError::RuntimeUnavailable);
        };
        let kelvin = kelvin.clamp(MIN_KELVIN.into(), MAX_KELVIN.into()) as u32;
        let gains = kelvin_to_f32_gains(kelvin);
        if gains_equal(last, gains) {
            return Ok(());
        }
        session
            .set_color_gains(gains)
            .map_err(|RuntimeLost| SetError::WriteFailed)?;
        // the values read back become the last known ones, so this write never looks external
        self.last = Some(read(session).unwrap_or(gains));
        Ok(())
    }

    fn publish(&mut self) -> Option<Snapshot> {
        let snapshot = self.last.map_or(Snapshot::UNAVAILABLE, Snapshot::of);
        if snapshot == self.snapshot {
            return None;
        }
        self.snapshot = snapshot.clone();
        Some(snapshot)
    }
}

fn read(session: &mut impl ColorGains) -> Result<[f32; 3], RuntimeLost> {
    Ok(session
        .color_gains()?
        .map(|gain| gain.unwrap_or(UNSET_GAIN)))
}

const GAIN_KEYS: [&std::ffi::CStr; 3] = [
    c"hmdDisplayColorGainR",
    c"hmdDisplayColorGainG",
    c"hmdDisplayColorGainB",
];

impl ColorGains for OpenVr {
    fn color_gains(&mut self) -> Result<[Option<f32>; 3], RuntimeLost> {
        let settings = self.context()?.settings();
        let mut gains = [None; 3];
        for (gain, key) in gains.iter_mut().zip(GAIN_KEYS) {
            *gain = match settings.get_float(c"steamvr", key) {
                Ok(value) => Some(value),
                Err(raphii_openvr_rs::Error::Runtime { code, .. })
                    if code
                        == raphii_openvr_rs::raw::EVRSettingsError::VRSettingsError_UnsetSettingHasNoDefault.0
                            as u32 =>
                {
                    None
                }
                Err(_) => return Err(RuntimeLost),
            };
        }
        Ok(gains)
    }

    fn set_color_gains(&mut self, gains: [f32; 3]) -> Result<(), RuntimeLost> {
        let settings = self.context()?.settings();
        for (gain, key) in gains.into_iter().zip(GAIN_KEYS) {
            settings
                .set_float(c"steamvr", key, gain)
                .map_err(|_| RuntimeLost)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Headset {
        gains: [Option<f32>; 3],
        running: bool,
        writes: Vec<[f32; 3]>,
        /// Every call in order, to check that a read comes before a write.
        calls: Vec<&'static str>,
    }

    impl Headset {
        fn at(gains: [f32; 3]) -> Self {
            Self {
                gains: gains.map(Some),
                running: true,
                ..Self::default()
            }
        }
    }

    impl ColorGains for Headset {
        fn color_gains(&mut self) -> Result<[Option<f32>; 3], RuntimeLost> {
            self.calls.push("read");
            self.running.then_some(self.gains).ok_or(RuntimeLost)
        }

        fn set_color_gains(&mut self, gains: [f32; 3]) -> Result<(), RuntimeLost> {
            self.calls.push("write");
            self.writes.push(gains);
            self.gains = gains.map(Some);
            Ok(())
        }
    }

    fn at(kelvin: u32) -> Snapshot {
        Snapshot::of(kelvin_to_f32_gains(kelvin))
    }

    #[test]
    fn reports_the_headset_on_start_without_writing() {
        let mut headset = Headset::at(kelvin_to_f32_gains(3000));
        let mut cct = Cct::default();
        assert_eq!(cct.snapshot(), &Snapshot::UNAVAILABLE);
        let snapshot = cct.poll(Some(&mut headset)).unwrap();
        assert_eq!((snapshot.kelvin, snapshot.exact), (Some(3000), Some(true)));
        assert_eq!(cct.poll(Some(&mut headset)), None);
        assert!(headset.writes.is_empty());
    }

    #[test]
    fn reads_unset_keys_as_one() {
        let mut headset = Headset {
            running: true,
            ..Headset::default()
        };
        let mut cct = Cct::default();
        assert_eq!(cct.poll(Some(&mut headset)), Some(at(6600)));
        headset.gains[2] = Some(0.5);
        let snapshot = cct.poll(Some(&mut headset)).unwrap();
        assert_eq!(snapshot.gains, Some([1.0, 1.0, 0.5]));
        assert_eq!(snapshot.exact, Some(false));
    }

    #[test]
    fn reports_each_external_change_once() {
        let mut headset = Headset::at(kelvin_to_f32_gains(6600));
        let mut cct = Cct::default();
        cct.poll(Some(&mut headset));
        headset.gains = kelvin_to_f32_gains(4000).map(Some);
        assert_eq!(cct.poll(Some(&mut headset)), Some(at(4000)));
        assert_eq!(cct.poll(Some(&mut headset)), None);
        // a difference within the tolerance is no change
        headset.gains[1] = headset.gains[1].map(|gain| gain + 5e-6);
        assert_eq!(cct.poll(Some(&mut headset)), None);
    }

    #[test]
    fn reports_a_partial_change_then_its_final_value() {
        let mut headset = Headset::at(kelvin_to_f32_gains(6600));
        let mut cct = Cct::default();
        cct.poll(Some(&mut headset));
        let target = kelvin_to_f32_gains(2000);
        headset.gains[0] = Some(target[0]);
        headset.gains[1] = Some(target[1]);
        let partial = cct.poll(Some(&mut headset)).unwrap();
        assert_eq!(partial.gains, Some([target[0], target[1], 1.0]));
        headset.gains[2] = Some(target[2]);
        assert_eq!(cct.poll(Some(&mut headset)), Some(at(2000)));
    }

    #[test]
    fn does_not_report_its_own_write() {
        let mut headset = Headset::at(kelvin_to_f32_gains(6600));
        let mut cct = Cct::default();
        cct.poll(Some(&mut headset));
        let outcome = cct.set(Some(&mut headset), 3000);
        assert_eq!(outcome.before, None);
        assert_eq!(outcome.result, Ok(at(3000)));
        assert_eq!(outcome.after, Some(at(3000)));
        assert_eq!(headset.writes, [kelvin_to_f32_gains(3000)]);
        assert_eq!(cct.poll(Some(&mut headset)), None);
    }

    #[test]
    fn reports_a_change_between_poll_and_write_before_the_write() {
        let mut headset = Headset::at(kelvin_to_f32_gains(6600));
        let mut cct = Cct::default();
        cct.poll(Some(&mut headset));
        headset.gains = kelvin_to_f32_gains(5000).map(Some);
        headset.calls.clear();
        let outcome = cct.set(Some(&mut headset), 3000);
        assert_eq!(outcome.before, Some(at(5000)));
        assert_eq!(outcome.result, Ok(at(3000)));
        assert_eq!(headset.calls, ["read", "write", "read"]);
    }

    #[test]
    fn writes_nothing_when_the_gains_already_match() {
        let mut headset = Headset::at(kelvin_to_f32_gains(3000));
        let mut cct = Cct::default();
        cct.poll(Some(&mut headset));
        let outcome = cct.set(Some(&mut headset), 3000);
        assert_eq!(outcome.result, Ok(at(3000)));
        assert_eq!(outcome.after, None);
        assert!(headset.writes.is_empty());
    }

    #[test]
    fn writes_the_shown_kelvin_over_off_curve_gains() {
        let mut headset = Headset::at([1.0, 1.0, 0.5]);
        let mut cct = Cct::default();
        let shown = cct.poll(Some(&mut headset)).unwrap();
        assert_eq!((shown.kelvin, shown.exact), (Some(3795), Some(false)));
        let outcome = cct.set(Some(&mut headset), 3795);
        assert_eq!(outcome.result, Ok(at(3795)));
        assert_eq!(headset.writes, [kelvin_to_f32_gains(3795)]);
    }

    #[test]
    fn clamps_the_kelvin() {
        let mut headset = Headset::at(kelvin_to_f32_gains(6600));
        let mut cct = Cct::default();
        assert_eq!(cct.set(Some(&mut headset), 200).result, Ok(at(1000)));
        assert_eq!(cct.set(Some(&mut headset), 50_000).result, Ok(at(10000)));
    }

    #[test]
    fn follows_runtime_loss_and_return_without_writing() {
        let mut headset = Headset::at(kelvin_to_f32_gains(3000));
        let mut cct = Cct::default();
        assert_eq!(cct.poll(None::<&mut Headset>), None);
        assert_eq!(
            cct.set(None::<&mut Headset>, 4000).result,
            Err(SetError::RuntimeUnavailable)
        );
        assert_eq!(cct.poll(Some(&mut headset)), Some(at(3000)));
        // a session whose reads fail is gone
        headset.running = false;
        assert_eq!(cct.poll(Some(&mut headset)), Some(Snapshot::UNAVAILABLE));
        assert_eq!(
            cct.set(Some(&mut headset), 4000).result,
            Err(SetError::RuntimeUnavailable)
        );
        // the same value returns as a new snapshot after the runtime comes back
        headset.running = true;
        assert_eq!(cct.poll(Some(&mut headset)), Some(at(3000)));
        assert!(headset.writes.is_empty());
    }
}

//! Converts between a color temperature in Kelvin and SteamVR's RGB display color gains. Pure, so
//! the Steam Frame helper builds this file without the rest of the crate.

use std::sync::LazyLock;

pub const MIN_KELVIN: u32 = 1000;
pub const MAX_KELVIN: u32 = 10000;
/// The temperature whose gains are all 1.
pub const NEUTRAL_KELVIN: u32 = 6600;
/// Gains closer than this per channel count as equal.
pub const GAIN_TOLERANCE: f32 = 1e-5;

/// The red, green, and blue gains from 0 to 1, after Tanner Helland's algorithm:
/// <https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html>.
/// The temperature is clamped to 1000–10000 K.
pub fn kelvin_to_gains(kelvin: u32) -> [f64; 3] {
    let temperature = kelvin.clamp(MIN_KELVIN, MAX_KELVIN) as f64 / 100.0;
    let red = if temperature <= 66.0 {
        255.0
    } else {
        let red = temperature - 60.0;
        let red = 329.698727446 * red.powf(-0.1332047592);
        red.clamp(0.0, 255.0)
    } / 255.0;
    let green = if temperature <= 66.0 {
        let green = temperature;
        let green = 99.4708025861 * green.ln() - 161.1195681661;
        green.clamp(0.0, 255.0)
    } else {
        let green = temperature - 60.0;
        let green = 288.1221695283 * green.powf(-0.0755148492);
        green.clamp(0.0, 255.0)
    } / 255.0;
    let blue = if temperature >= 66.0 {
        255.0
    } else if temperature <= 19.0 {
        0.0
    } else {
        let blue = temperature - 10.0;
        let blue = 138.5177312231 * blue.ln() - 305.0447927307;
        blue.clamp(0.0, 255.0)
    } / 255.0;
    [red, green, blue]
}

/// The gains as SteamVR stores them.
pub fn kelvin_to_f32_gains(kelvin: u32) -> [f32; 3] {
    kelvin_to_gains(kelvin).map(|gain| gain as f32)
}

/// The gains of every integer Kelvin from 1000 to 10000.
static CURVE: LazyLock<Vec<[f32; 3]>> =
    LazyLock::new(|| (MIN_KELVIN..=MAX_KELVIN).map(kelvin_to_f32_gains).collect());

/// The integer Kelvin whose gains are nearest to `gains` divided by their largest channel, and
/// whether `gains` equal that Kelvin's gains within [`GAIN_TOLERANCE`]. All zero gives 6600, not
/// exact.
pub fn gains_to_kelvin(gains: [f32; 3]) -> (u32, bool) {
    let largest = gains.into_iter().fold(0.0f32, f32::max);
    if largest <= 0.0 {
        return (NEUTRAL_KELVIN, false);
    }
    let normalized = gains.map(|gain| gain / largest);
    let distance =
        |curve: &[f32; 3]| -> f32 { (0..3).map(|i| (curve[i] - normalized[i]).powi(2)).sum() };
    // ponytail: a linear scan over 9001 values, which only runs when the gains change
    let (offset, curve) = CURVE
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| distance(a).total_cmp(&distance(b)))
        .expect("the curve has 9001 points");
    (MIN_KELVIN + offset as u32, gains_equal(gains, *curve))
}

pub fn gains_equal(a: [f32; 3], b: [f32; 3]) -> bool {
    (0..3).all(|i| (a[i] - b[i]).abs() <= GAIN_TOLERANCE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kelvin_round_trips_through_f32() {
        for kelvin in MIN_KELVIN..=MAX_KELVIN {
            assert_eq!(gains_to_kelvin(kelvin_to_f32_gains(kelvin)), (kelvin, true));
        }
    }

    #[test]
    fn keeps_the_index_output() {
        assert_eq!(kelvin_to_f32_gains(1000), [1.0, 0.2663546, 0.0]);
        assert_eq!(kelvin_to_f32_gains(3000), [1.0, 0.694903, 0.431048]);
        assert_eq!(kelvin_to_f32_gains(6600), [1.0, 1.0, 1.0]);
        assert_eq!(kelvin_to_f32_gains(10000), [0.79099745, 0.8551793, 1.0]);
        assert_eq!(kelvin_to_f32_gains(500), kelvin_to_f32_gains(1000));
        assert_eq!(kelvin_to_f32_gains(20000), kelvin_to_f32_gains(10000));
    }

    #[test]
    fn finds_the_nearest_kelvin_for_off_curve_gains() {
        assert_eq!(gains_to_kelvin([1.0, 0.6, 0.2]), (2313, false));
        assert_eq!(gains_to_kelvin([1.0, 1.0, 0.5]), (3795, false));
        assert_eq!(gains_to_kelvin([1.0, 0.0, 0.0]), (1000, false));
        assert_eq!(gains_to_kelvin([0.5, 0.5, 0.5]), (6600, false));
    }

    #[test]
    fn all_channels_at_zero_read_as_neutral() {
        assert_eq!(gains_to_kelvin([0.0, 0.0, 0.0]), (6600, false));
    }
}

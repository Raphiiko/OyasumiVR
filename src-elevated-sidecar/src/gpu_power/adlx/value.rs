const SHIFT_PERCENT: i32 = 100;
const SCALE: u32 = 1000;

pub(super) fn encode_percent(percent: i32) -> u32 {
    let shifted = percent.saturating_add(SHIFT_PERCENT);
    if shifted <= 0 {
        return 0;
    }

    (shifted as u32).saturating_mul(SCALE)
}

pub(super) fn decode_percent(encoded: u32) -> i32 {
    let shifted = (encoded / SCALE).min(i32::MAX as u32) as i32;
    shifted.saturating_sub(SHIFT_PERCENT)
}

#[cfg(test)]
mod tests {
    use super::{decode_percent, encode_percent};

    #[test]
    fn percentage_offsets_round_trip_through_legacy_field() {
        for percent in [-100, -20, 0, 15, 100] {
            assert_eq!(decode_percent(encode_percent(percent)), percent);
        }
    }

    #[test]
    fn values_below_representable_range_saturate() {
        assert_eq!(encode_percent(i32::MIN), 0);
        assert_eq!(decode_percent(0), -100);
    }
}

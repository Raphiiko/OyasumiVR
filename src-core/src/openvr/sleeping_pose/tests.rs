use super::geometry::{PoseGeometry, SleepingPose};
use super::{classify, PoseTracker};
use crate::openvr::devices::quaternion_from_tracking_matrix;

/// A headset at `pitch` and `roll` degrees, Euler order YXZ with no yaw, as `[x, y, z, w]`.
fn headset(pitch: f64, roll: f64) -> [f64; 4] {
    let (s1, c1) = (pitch.to_radians() / 2.0).sin_cos();
    let (s3, c3) = (roll.to_radians() / 2.0).sin_cos();
    [s1 * c3, -s1 * s3, c1 * s3, c1 * c3]
}

fn pose(pitch: f64, roll: f64) -> Option<SleepingPose> {
    PoseGeometry::new(headset(pitch, roll)).active_pose()
}

#[test]
fn classifies_basic_headset_orientations() {
    assert_eq!(pose(0.0, 0.0), Some(SleepingPose::SideFront));
    assert_eq!(pose(75.0, 0.0), Some(SleepingPose::SideBack));
    assert_eq!(pose(0.0, 90.0), Some(SleepingPose::SideLeft));
    assert_eq!(pose(0.0, -90.0), Some(SleepingPose::SideRight));
}

#[test]
fn ignores_yaw_and_the_sign_of_the_quaternion() {
    let (s, c) = (50f64.to_radians() / 2.0).sin_cos();
    let [x, y, z, w] = headset(0.0, 90.0);
    // yaw first, then the pitch and roll
    let yawed = [c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y];
    assert_eq!(
        PoseGeometry::new(yawed).active_pose(),
        Some(SleepingPose::SideLeft)
    );
    assert_eq!(
        PoseGeometry::new(yawed.map(|v| -v)).active_pose(),
        Some(SleepingPose::SideLeft)
    );
}

#[test]
fn keeps_the_previous_pose_without_a_collision() {
    // face down collides with no receiver
    let geometry = PoseGeometry::new(headset(-90.0, 180.0));
    assert_eq!(geometry.active_pose(), None);
    assert_eq!(
        classify(&geometry, SleepingPose::SideLeft),
        SleepingPose::SideLeft
    );
}

#[test]
fn converts_tracking_matrices_to_quaternions() {
    let identity = [
        [1.0, 0.0, 0.0, 0.5],
        [0.0, 1.0, 0.0, 1.6],
        [0.0, 0.0, 1.0, -0.2],
    ];
    assert_eq!(
        quaternion_from_tracking_matrix(&identity),
        [0.0, 0.0, 0.0, 1.0]
    );
    // 90 degrees of roll around z
    let rolled = [
        [0.0, -1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];
    let [x, y, z, w] = quaternion_from_tracking_matrix(&rolled);
    let half = std::f64::consts::FRAC_1_SQRT_2;
    assert_eq!([x, y], [0.0, 0.0]);
    assert!((z - half).abs() < 1e-12 && (w - half).abs() < 1e-12);
}

fn sample(tracker: &mut PoseTracker, now_ms: u64, pitch: f64, roll: f64) {
    tracker.sample(now_ms, &PoseGeometry::new(headset(pitch, roll)));
}

#[test]
fn a_window_with_two_agreeing_samples_sets_the_stable_pose() {
    let mut tracker = PoseTracker::new(0);
    sample(&mut tracker, 250, 0.0, 90.0);
    sample(&mut tracker, 500, 0.0, 90.0);
    assert_eq!(tracker.advance(999), None);
    assert_eq!(tracker.advance(1000), Some(SleepingPose::SideLeft));
    assert_eq!(tracker.stable_pose(), SleepingPose::SideLeft);

    // the same pose again changes nothing
    sample(&mut tracker, 1250, 0.0, 90.0);
    sample(&mut tracker, 1500, 0.0, 90.0);
    assert_eq!(tracker.advance(2000), None);
}

#[test]
fn a_window_with_one_or_mixed_samples_keeps_the_stable_pose() {
    let mut tracker = PoseTracker::new(0);
    sample(&mut tracker, 250, 0.0, 90.0);
    assert_eq!(tracker.advance(1000), None);
    sample(&mut tracker, 1250, 0.0, 90.0);
    sample(&mut tracker, 1500, 0.0, -90.0);
    assert_eq!(tracker.advance(2000), None);
    assert_eq!(tracker.stable_pose(), SleepingPose::Unknown);
}

#[test]
fn samples_without_a_collision_repeat_the_previous_pose() {
    let mut tracker = PoseTracker::new(0);
    sample(&mut tracker, 250, 0.0, -90.0);
    sample(&mut tracker, 500, -90.0, 180.0);
    assert_eq!(tracker.advance(1000), Some(SleepingPose::SideRight));
}

#[test]
fn a_forced_pose_holds_until_a_window_agrees_on_another() {
    let mut tracker = PoseTracker::new(0);
    assert_eq!(
        tracker.set_stable(SleepingPose::SideBack),
        Some(SleepingPose::SideBack)
    );
    assert_eq!(tracker.set_stable(SleepingPose::SideBack), None);
    sample(&mut tracker, 250, 75.0, 0.0);
    sample(&mut tracker, 500, 75.0, 0.0);
    assert_eq!(tracker.advance(1000), None);
    sample(&mut tracker, 1250, 0.0, 0.0);
    sample(&mut tracker, 1500, 0.0, 0.0);
    assert_eq!(tracker.advance(2000), Some(SleepingPose::SideFront));
}

#[test]
fn closes_every_window_that_ended_during_a_gap() {
    let mut tracker = PoseTracker::new(0);
    sample(&mut tracker, 250, 0.0, 90.0);
    sample(&mut tracker, 500, 0.0, 90.0);
    assert_eq!(tracker.advance(5300), Some(SleepingPose::SideLeft));
    sample(&mut tracker, 5400, 0.0, -90.0);
    sample(&mut tracker, 5600, 0.0, -90.0);
    assert_eq!(tracker.advance(5999), None);
    assert_eq!(tracker.advance(6000), Some(SleepingPose::SideRight));
}

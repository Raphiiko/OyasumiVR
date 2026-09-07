use crate::utils::{get_time, send_event};

use super::models::SleepDetectorStateReport;

const MAX_EVENT_AGE_MS: u128 = 900000; // 15 minutes

#[derive(Clone, Copy)]
struct PoseEvent {
    x: f32,
    y: f32,
    z: f32,
    quaternion: [f64; 4],
    timestamp: u128, // in milliseconds
}

impl PoseEvent {
    fn distance_to(&self, other: &PoseEvent) -> f64 {
        let dx: f64 = (self.x - other.x).into();
        let dy: f64 = (self.y - other.y).into();
        let dz: f64 = (self.z - other.z).into();
        (dx * dx + dy * dy + dz * dz).sqrt()
    }
    fn angular_distance_degrees(&self, other: &PoseEvent) -> f64 {
        let q1 = self.quaternion;
        let q2 = other.quaternion;
        let dot_product = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
        let angle = 2.0 * dot_product.abs().clamp(-1.0, 1.0).acos();

        angle * 180.0 / std::f64::consts::PI
    }
}

pub struct SleepDetector {
    events: Vec<PoseEvent>,
    distance_in_last_15_minutes: f64,
    distance_in_last_10_minutes: f64,
    distance_in_last_5_minutes: f64,
    distance_in_last_1_minute: f64,
    distance_in_last_10_seconds: f64,
    rotation_in_last_15_minutes: f64,
    rotation_in_last_10_minutes: f64,
    rotation_in_last_5_minutes: f64,
    rotation_in_last_1_minute: f64,
    rotation_in_last_10_seconds: f64,
    start_time: u128,
    last_log: u128,
    next_state_report: u128,
}

impl SleepDetector {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            distance_in_last_10_seconds: 0.0,
            distance_in_last_1_minute: 0.0,
            distance_in_last_5_minutes: 0.0,
            distance_in_last_10_minutes: 0.0,
            distance_in_last_15_minutes: 0.0,
            rotation_in_last_10_seconds: 0.0,
            rotation_in_last_1_minute: 0.0,
            rotation_in_last_5_minutes: 0.0,
            rotation_in_last_10_minutes: 0.0,
            rotation_in_last_15_minutes: 0.0,
            start_time: 0,
            last_log: 0,
            next_state_report: 0,
        }
    }

    pub async fn log_pose(&mut self, position: [f32; 3], quaternion: [f64; 4]) {
        // retain the latest fifteen minutes of poses
        let event = PoseEvent {
            x: position[0],
            y: position[1],
            z: position[2],
            quaternion,
            timestamp: get_time(),
        };
        self.events.push(event);
        let oldest_time = event.timestamp - MAX_EVENT_AGE_MS;
        let old_event_count = self
            .events
            .iter()
            .take_while(|e| e.timestamp < oldest_time)
            .count();
        self.events.drain(..old_event_count);
        // restart the observation window after a minute without poses
        if get_time().saturating_sub(self.last_log) > 60000 {
            self.start_time = get_time();
        }
        self.last_log = event.timestamp;

        // recompute movement only for the next published report
        if self.take_report_slot(get_time()) {
            self.recompute_windows();
            self.send_state_report().await;
        }
    }

    fn take_report_slot(&mut self, now: u128) -> bool {
        if now <= self.next_state_report {
            return false;
        }
        self.next_state_report = now + 1000;
        true
    }

    fn recompute_windows(&mut self) {
        self.distance_in_last_15_minutes = self.distance_in_window(900000);
        self.distance_in_last_10_minutes = self.distance_in_window(600000);
        self.distance_in_last_5_minutes = self.distance_in_window(300000);
        self.distance_in_last_1_minute = self.distance_in_window(60000);
        self.distance_in_last_10_seconds = self.distance_in_window(10000);
        self.rotation_in_last_15_minutes = self.rotation_in_window(900000);
        self.rotation_in_last_10_minutes = self.rotation_in_window(600000);
        self.rotation_in_last_5_minutes = self.rotation_in_window(300000);
        self.rotation_in_last_1_minute = self.rotation_in_window(60000);
        self.rotation_in_last_10_seconds = self.rotation_in_window(10000);
    }

    fn distance_in_window(&self, window_ms: u128) -> f64 {
        let start_time = get_time() - window_ms;
        let start_index = self
            .events
            .iter()
            .position(|e| e.timestamp >= start_time)
            .unwrap_or(0);
        let events = &self.events[start_index..];
        let mut total_distance = 0.0;
        let mut i = 0;
        while i < events.len() - 1 {
            let event_a = &events[i];
            let event_b = &events[i + 1];
            let distance = event_a.distance_to(event_b);
            total_distance += distance;
            i += 1;
        }
        total_distance
    }

    fn rotation_in_window(&self, window_ms: u128) -> f64 {
        let start_time = get_time() - window_ms;
        let start_index = self
            .events
            .iter()
            .position(|e| e.timestamp >= start_time)
            .unwrap_or(0);
        let events = &self.events[start_index..];
        let mut total_rotation = 0.0;
        let mut i = 0;
        while i < events.len() - 1 {
            let event_a = &events[i];
            let event_b = &events[i + 1];
            let rotation = event_a.angular_distance_degrees(event_b);
            total_rotation += rotation;
            i += 1;
        }
        total_rotation
    }

    async fn send_state_report(&self) {
        send_event(
            "SLEEP_DETECTOR_STATE_REPORT",
            SleepDetectorStateReport {
                distance_in_last_15_minutes: self.distance_in_last_15_minutes,
                distance_in_last_10_minutes: self.distance_in_last_10_minutes,
                distance_in_last_5_minutes: self.distance_in_last_5_minutes,
                distance_in_last_1_minute: self.distance_in_last_1_minute,
                distance_in_last_10_seconds: self.distance_in_last_10_seconds,
                rotation_in_last_15_minutes: self.rotation_in_last_15_minutes,
                rotation_in_last_10_minutes: self.rotation_in_last_10_minutes,
                rotation_in_last_5_minutes: self.rotation_in_last_5_minutes,
                rotation_in_last_1_minute: self.rotation_in_last_1_minute,
                rotation_in_last_10_seconds: self.rotation_in_last_10_seconds,
                start_time: self.start_time,
                last_log: self.last_log,
            },
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saturated_history_preserves_all_ten_movement_totals() {
        let mut detector = SleepDetector::new();
        let now = get_time();
        for (count, age) in [
            (9375, 700000),
            (9375, 450000),
            (7500, 180000),
            (1562, 30000),
            (313, 5000),
        ] {
            for _ in 0..count {
                let index = detector.events.len();
                detector.events.push(PoseEvent {
                    x: index as f32,
                    y: 0.0,
                    z: 0.0,
                    quaternion: if index % 2 == 0 {
                        [1.0, 0.0, 0.0, 0.0]
                    } else {
                        [
                            std::f64::consts::FRAC_1_SQRT_2,
                            0.0,
                            0.0,
                            std::f64::consts::FRAC_1_SQRT_2,
                        ]
                    },
                    timestamp: now - age,
                });
            }
        }
        assert_eq!(detector.events.len(), 28125);
        detector.recompute_windows();
        let distances = [
            detector.distance_in_last_15_minutes,
            detector.distance_in_last_10_minutes,
            detector.distance_in_last_5_minutes,
            detector.distance_in_last_1_minute,
            detector.distance_in_last_10_seconds,
        ];
        let rotations = [
            detector.rotation_in_last_15_minutes,
            detector.rotation_in_last_10_minutes,
            detector.rotation_in_last_5_minutes,
            detector.rotation_in_last_1_minute,
            detector.rotation_in_last_10_seconds,
        ];
        assert_eq!(distances, [28124.0, 18749.0, 9374.0, 1874.0, 312.0]);
        for (actual, expected) in rotations
            .into_iter()
            .zip([2531160.0, 1687410.0, 843660.0, 168660.0, 28080.0])
        {
            assert!((actual - expected).abs() < 0.000001);
        }
    }

    #[test]
    fn report_gate_keeps_the_strict_one_second_boundary_without_catching_up() {
        let mut detector = SleepDetector::new();
        assert!(detector.take_report_slot(10000));
        for now in 10000..=11000 {
            assert!(!detector.take_report_slot(now));
        }
        assert!(detector.take_report_slot(11001));
        assert!(detector.take_report_slot(80000));
        assert!(!detector.take_report_slot(80000));
        assert!(!detector.take_report_slot(81000));
        assert!(detector.take_report_slot(81001));
    }

    #[tokio::test]
    async fn poses_between_reports_retain_history_and_timestamps_without_recomputing() {
        let mut detector = SleepDetector::new();
        let before = get_time();
        detector.next_state_report = u128::MAX;
        detector.distance_in_last_15_minutes = 123.0;
        detector.last_log = before - 60001;
        detector.events.push(PoseEvent {
            x: 99.0,
            y: 0.0,
            z: 0.0,
            quaternion: [1.0, 0.0, 0.0, 0.0],
            timestamp: before - MAX_EVENT_AGE_MS - 1,
        });

        detector
            .log_pose([1.0, 2.0, 3.0], [1.0, 0.0, 0.0, 0.0])
            .await;
        assert_eq!(detector.events.len(), 1);
        assert_eq!(detector.last_log, detector.events[0].timestamp);
        assert!(detector.start_time >= before && detector.start_time <= get_time());
        let start_time = detector.start_time;

        detector
            .log_pose([4.0, 5.0, 6.0], [1.0, 0.0, 0.0, 0.0])
            .await;
        assert_eq!(detector.events.len(), 2);
        assert_eq!(detector.last_log, detector.events[1].timestamp);
        assert_eq!(detector.start_time, start_time);
        assert_eq!(detector.distance_in_last_15_minutes, 123.0);
    }
}

use crate::utils::{get_time, send_event};

use super::models::SleepDetectorStateReport;

const MAX_EVENT_AGE_MS: u64 = 900000; // 15 minutes

#[derive(Clone, Copy)]
struct PoseEvent {
    x: f32,
    y: f32,
    z: f32,
    // quaternion: [f64; 4],
    timestamp: u64, // in milliseconds
}

impl PoseEvent {
    fn distance_to(&self, other: &PoseEvent) -> f32 {
        let dx: f32 = (self.x - other.x).into();
        let dy: f32 = (self.y - other.y).into();
        let dz: f32 = (self.z - other.z).into();
        (dx * dx + dy * dy + dz * dz).sqrt()

    }
    // fn angular_distance_degrees(&self, other: &PoseEvent) -> f64 {
    //     let q1 = self.quaternion;
    //     let q2 = other.quaternion;
    //     let dot_product = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
    //     let angle = 2.0 * dot_product.abs().clamp(-1.0, 1.0).acos();

    //     angle * 180.0 / std::f64::consts::PI
    // }
}

pub struct SleepDetector {
    events: Vec<PoseEvent>,
    distance_in_last_15_minutes: f32,
    distance_in_last_10_seconds: f32,
    // reqwest_client: reqwest::Client,
    start_time: u64,
    last_log: u64,
    next_state_report: u64,
}

impl SleepDetector {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            distance_in_last_10_seconds: 0.0,
            distance_in_last_15_minutes: 0.0,
            // reqwest_client: reqwest::Client::new(),
            start_time: 0,
            last_log: 0,
            next_state_report: 0,
        }
    }

    pub async fn log_pose(&mut self, position: [f32; 3]) {
        // Add the event
        let event = PoseEvent {
            x: position[0],
            y: position[1],
            z: position[2],
            timestamp: get_time(),
        };
        self.events.push(event);
        // Remove old events
        let oldest_time = event.timestamp - MAX_EVENT_AGE_MS;
        let old_event_count = self
            .events
            .iter()
            .take_while(|e| e.timestamp < oldest_time)
            .count();
        self.events.drain(..old_event_count);
        // Calculate new distances
        self.distance_in_last_15_minutes = self.distance_in_window(900000);
        self.distance_in_last_10_seconds = self.distance_in_window(10000);
        // Set new start time if there hasn't been any data in over a minute
        if get_time().saturating_sub(self.last_log) > 60000 {
            self.start_time = get_time();
        }
        // Update the last log time
        self.last_log = event.timestamp;
        // Send a state report if it's been over a second since the last one
        if get_time() > self.next_state_report {
            self.next_state_report = get_time() + 1000;
            self.send_state_report().await;
        }
    }

    fn distance_in_window(&mut self, window_ms: u64) -> f32 {
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

    async fn send_state_report(&self) {
        send_event(
            "SLEEP_DETECTOR_STATE_REPORT",
            SleepDetectorStateReport {
                distance_in_last_15_minutes: self.distance_in_last_15_minutes,
                distance_in_last_10_seconds: self.distance_in_last_10_seconds,
                start_time: self.start_time,
                last_log: self.last_log,
            },
        )
        .await;
        // self.send_influxdb_report();
    }

    // #[tokio::main]
    // async fn send_influxdb_report(&self) {
    //     let f = self.reqwest_client
    //     .post("http://localhost:8086/api/v2/write?org=org&bucket=bucket&precision=ms")
    //     .header("Authorization", "Token yXuwflYgacQn8GQp7VmXV23jdC5mG3k5XVBHiA7_Ojv7xCLZyB-FttolJcCRop4knUvN-vi_uMxbZjaBa5SfbQ==") // Yes this is a token I checked in. It's for a local test database, for debugging. Don't worry about it.
    //     .header("Content-Type", "text/plain; charset=utf-8")
    //     .header("Accept", "application/json")
    //     .body(format!(
    //         "sleep_detector distance_in_last_15_minutes={},distance_in_last_10_minutes={},distance_in_last_5_minutes={},distance_in_last_1_minute={},distance_in_last_10_seconds={},rotation_in_last_15_minutes={},rotation_in_last_10_minutes={},rotation_in_last_5_minutes={},rotation_in_last_1_minute={},rotation_in_last_10_seconds={} {}",
    //         self.distance_in_last_15_minutes,
    //         self.distance_in_last_10_minutes,
    //         self.distance_in_last_5_minutes,
    //         self.distance_in_last_1_minute,
    //         self.distance_in_last_10_seconds,
    //         self.rotation_in_last_15_minutes,
    //         self.rotation_in_last_10_minutes,
    //         self.rotation_in_last_5_minutes,
    //         self.rotation_in_last_1_minute,
    //         self.rotation_in_last_10_seconds,
    //         self.last_log
    //     ))
    //     .send();
    //     // Block until the request is sent
    //     let _ = futures::executor::block_on(f);
    // }
}

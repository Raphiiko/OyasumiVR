use nalgebra::{Quaternion, UnitQuaternion};

use crate::utils::{get_time, send_event};

use super::models::GestureDetected;

const MAX_EVENT_AGE_MS: u64 = 5000; // 5 seconds

#[derive(Clone, Copy)]
struct YawEvent {
    yaw: f32,
}

pub struct GestureDetector {
    events: Vec<YawEvent>,
    events_timestamps: Vec<u64>,
    last_detection: u64,
}

impl GestureDetector {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            events_timestamps: Vec::new(),
            last_detection: 0,
        }
    }

    pub async fn log_pose(&mut self, _position: [f32; 3], quaternion: [f32; 4]) {
        let now=get_time();
        // Determine yaw
        let q = UnitQuaternion::from_quaternion(Quaternion::new(
            quaternion[3],
            quaternion[0],
            quaternion[1],
            quaternion[2],
        ));
        let yaw = (2.0 * q.as_ref().imag().y.atan2(q.as_ref().scalar())).to_radians()
            + 180.0;
        // Log yaw event
        let event = YawEvent {
            yaw,
        };
        debug_assert_eq!(self.events.len(),self.events_timestamps.len());
        self.events.push(event);
        self.events_timestamps.push(now);
        // Remove old events
        let oldest_time = now - MAX_EVENT_AGE_MS;
        let old_event_count = self
            .events_timestamps
            .iter()
            .take_while(|t| **t < oldest_time)
            .count();
        self.events.drain(..old_event_count);
        // Convert events to relative movements
        let mut movements = Vec::new();
        for i in 0..self.events.len() - 1 {
            let yaw1 = self.events[i].yaw;
            let yaw2 = self.events[i + 1].yaw;
            let yaw_diff = yaw2 - yaw1;
            let yaw_diff = if yaw_diff > 180.0 {
                yaw_diff - 360.0
            } else if yaw_diff < -180.0 {
                yaw_diff + 360.0
            } else {
                yaw_diff
            };
            movements.push(yaw_diff);
        }
        // Detect head shake
        if get_time() - self.last_detection >= 5000 && self.detect_head_shake(movements) {
            self.last_detection = get_time();
            send_event(
                "GESTURE_DETECTED",
                GestureDetected {
                    gesture: "head_shake".to_string(),
                },
            )
            .await;
        }
    }

    fn detect_head_shake(&self, movements: Vec<f32>) -> bool {
        let mut data = movements;
        let mut offset_dir = 1.0;
        let mut change: Option<usize>;
        let change_dir_a = self.detect_angular_change(data.clone(), -15.0);
        let change_dir_b = self.detect_angular_change(data.clone(), 15.0);
        if change_dir_a.is_some() {
            change = change_dir_a;
        } else if change_dir_b.is_some() {
            change = change_dir_b;
            offset_dir = -1.0;
        } else {
            return false;
        }
        data = data[change.unwrap()..].to_vec();
        change = self.detect_angular_change(data.clone(), 30.0 * offset_dir);
        if change.is_none() {
            return false;
        }
        data = data[change.unwrap()..].to_vec();
        change = self.detect_angular_change(data, -15.0 * offset_dir);
        if change.is_none() {
            return false;
        }
        true
    }

    fn detect_angular_change(&self, mut data: Vec<f32>, mut offset: f32) -> Option<usize> {
        let mut delta = 0.0;
        // Flip data if we're looking for a negative offset
        if offset < 0.0 {
            data = data.iter().map(|x| -x).collect();
            offset *= -1.0;
        }
        // Loop over all data points
        for (i, item) in data.iter().enumerate() {
            delta += item;
            // if delta is negative, reset to 0
            if delta < 0.0 {
                delta = 0.0;
            }
            // If we have passed the given offset, angular change has been detected
            if delta >= offset {
                return Some(i);
            }
        }
        // Desired angular change could not be found
        None
    }
}

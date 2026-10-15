pub mod commands;
mod geometry;
#[cfg(test)]
mod tests;

pub use geometry::{PoseGeometry, SleepingPose};

use crate::utils::send_event;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock,
};
use std::time::Instant;
use tokio::sync::Mutex;

/// The shortest time between two classified headset poses.
const SAMPLE_INTERVAL_MS: u64 = 250;
/// The length of the window in which every classification must agree.
const WINDOW_MS: u64 = 1000;

static TRACKER: LazyLock<Mutex<PoseTracker>> = LazyLock::new(|| Mutex::new(PoseTracker::new(0)));
static EPOCH: LazyLock<Instant> = LazyLock::new(Instant::now);
static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSnapshot {
    quaternion: [f64; 4],
    geometry: PoseGeometry,
    raw_pose: SleepingPose,
    stable_pose: SleepingPose,
}

/// Debounces raw classifications into a stable pose.
///
/// Windows of [`WINDOW_MS`] follow each other from `start_ms`. A window with at least two
/// classifications that all agree makes that pose stable.
pub struct PoseTracker {
    raw_pose: SleepingPose,
    window: Vec<SleepingPose>,
    window_end_ms: u64,
    next_sample_ms: u64,
    stable_pose: SleepingPose,
}

impl PoseTracker {
    pub fn new(start_ms: u64) -> Self {
        Self {
            raw_pose: classify(
                &PoseGeometry::new([0.0, 0.0, 0.0, 1.0]),
                SleepingPose::Unknown,
            ),
            window: Vec::new(),
            window_end_ms: start_ms + WINDOW_MS,
            next_sample_ms: 0,
            stable_pose: SleepingPose::Unknown,
        }
    }

    /// Closes every window that ended by `now_ms`, and returns the stable pose if it changed.
    pub fn advance(&mut self, now_ms: u64) -> Option<SleepingPose> {
        let mut changed = None;
        while now_ms >= self.window_end_ms {
            let window = std::mem::take(&mut self.window);
            self.window_end_ms += WINDOW_MS;
            if window.len() >= 2 && window.iter().all(|&pose| pose == window[0]) {
                changed = self.set_stable(window[0]).or(changed);
            }
        }
        changed
    }

    /// Whether a headset pose at `now_ms` is due for classification.
    pub fn sample_due(&self, now_ms: u64) -> bool {
        now_ms > self.next_sample_ms
    }

    /// Classifies a headset pose into the current window. Call [`Self::advance`] first.
    pub fn sample(&mut self, now_ms: u64, geometry: &PoseGeometry) -> SleepingPose {
        self.next_sample_ms = now_ms + SAMPLE_INTERVAL_MS;
        self.raw_pose = classify(geometry, self.raw_pose);
        self.window.push(self.raw_pose);
        self.raw_pose
    }

    /// Closes the windows that ended by `now_ms`, then sets the stable pose to `pose`.
    ///
    /// Returns every change of the stable pose, in order.
    pub fn force(&mut self, now_ms: u64, pose: SleepingPose) -> Vec<SleepingPose> {
        let closed = self.advance(now_ms);
        closed.into_iter().chain(self.set_stable(pose)).collect()
    }

    /// Sets the stable pose, and returns it if it changed.
    pub fn set_stable(&mut self, pose: SleepingPose) -> Option<SleepingPose> {
        if pose == self.stable_pose {
            return None;
        }
        self.stable_pose = pose;
        Some(pose)
    }

    pub fn stable_pose(&self) -> SleepingPose {
        self.stable_pose
    }
}

/// The colliding pose, or `previous` when no receiver collides.
pub fn classify(geometry: &PoseGeometry, previous: SleepingPose) -> SleepingPose {
    geometry.active_pose().unwrap_or(previous)
}

fn now_ms() -> u64 {
    EPOCH.elapsed().as_millis() as u64
}

/// Closes the windows that ended and publishes the stable pose if it changed.
///
/// Call with the tracker locked, so a forced pose cannot overtake the update.
async fn publish_closed_windows(tracker: &mut PoseTracker, now: u64) {
    if let Some(pose) = tracker.advance(now) {
        send_event("SLEEPING_POSE_UPDATE", pose).await;
    }
}

/// Call on every OpenVR task iteration, whether SteamVR runs or not, so windows close on time.
pub async fn on_task_tick() {
    publish_closed_windows(&mut *TRACKER.lock().await, now_ms()).await;
}

/// Call on every OpenVR device tick, with the headset orientation when its pose is valid.
pub async fn on_ovr_tick(hmd_quaternion: Option<[f64; 4]>) {
    let now = now_ms();
    let mut tracker = TRACKER.lock().await;
    publish_closed_windows(&mut tracker, now).await;
    let mut snapshot = None;
    if let Some(quaternion) = hmd_quaternion.filter(|_| tracker.sample_due(now)) {
        let geometry = PoseGeometry::new(quaternion);
        let raw_pose = tracker.sample(now, &geometry);
        if DEBUG_ENABLED.load(Ordering::Relaxed) {
            snapshot = Some(DebugSnapshot {
                quaternion,
                geometry,
                raw_pose,
                stable_pose: tracker.stable_pose(),
            });
        }
    }
    drop(tracker);

    if let Some(snapshot) = snapshot {
        send_event("SLEEPING_POSE_DEBUG", snapshot).await;
    }
}

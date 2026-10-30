use super::{classify, now_ms, DebugSnapshot, PoseGeometry, SleepingPose, DEBUG_ENABLED, TRACKER};
use crate::utils::send_event;
use std::sync::atomic::Ordering;

#[tauri::command]
#[specta::specta]
pub async fn sleeping_pose_get() -> SleepingPose {
    TRACKER.lock().await.stable_pose()
}

#[tauri::command]
#[specta::specta]
pub async fn sleeping_pose_force(pose: SleepingPose) {
    let mut tracker = TRACKER.lock().await;
    for pose in tracker.force(now_ms(), pose) {
        send_event("SLEEPING_POSE_UPDATE", pose).await;
    }
}

/// Starts or stops the `SLEEPING_POSE_DEBUG` event with the geometry of every classification.
#[tauri::command]
#[specta::specta]
pub fn sleeping_pose_set_debug(enabled: bool) {
    DEBUG_ENABLED.store(enabled, Ordering::Relaxed);
}

/// The geometry and classification of `quaternion`, without changing the tracked pose.
#[tauri::command]
#[specta::specta]
pub async fn sleeping_pose_debug_preview(quaternion: [f64; 4]) -> DebugSnapshot {
    let tracker = TRACKER.lock().await;
    let geometry = PoseGeometry::new(quaternion);
    DebugSnapshot {
        quaternion,
        raw_pose: classify(&geometry, tracker.raw_pose),
        geometry,
        stable_pose: tracker.stable_pose(),
    }
}

use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

/// Sent at the start of every minute.
#[derive(Serialize, Clone, Type, Event)]
pub struct CronMinuteStartEvent;

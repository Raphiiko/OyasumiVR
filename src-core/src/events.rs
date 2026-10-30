use serde::Serialize;

use crate::utils::event;

/// Sent at the start of every minute.
#[derive(Serialize, Clone, specta::Type)]
pub struct CronMinuteStartEvent;
event!(CronMinuteStartEvent, "CRON_MINUTE_START");

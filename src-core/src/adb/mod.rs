use std::sync::LazyLock;
use tokio::sync::Mutex;

use adb_client::ADBServer;

pub mod commands;
pub mod models;

static ADB_SERVER: LazyLock<Mutex<ADBServer>> = LazyLock::new(|| Mutex::new(ADBServer::default()));

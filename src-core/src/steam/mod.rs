use log::error;
use std::sync::LazyLock;
use steamworks::{AppId, CallbackHandle, Client, UserStatsReceived};
use tokio::sync::Mutex;

pub mod commands;

pub const STEAM_APP_ID: AppId = AppId(2538150);

pub static STEAMWORKS_CLIENT: LazyLock<Mutex<Option<Client>>> = LazyLock::new(Mutex::default);
pub static STEAMWORKS_USER_STATS_FETCHED: LazyLock<Mutex<bool>> =
    LazyLock::new(|| Mutex::new(false));

pub async fn init() {
    if crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Steam
        && crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Dev
    {
        return;
    }
    let client = match Client::init_app(STEAM_APP_ID) {
        Ok(client) => client,
        Err(e) => {
            error!("[Core] Failed to initialize Steamworks client. Steam-related functionality will be disabled. {e:#?}");
            return;
        }
    };
    // Store the steamworks client
    *STEAMWORKS_CLIENT.lock().await = Some(client);
    // Send an event to the UI to indicate that Steamworks is ready
    crate::utils::send_event("STEAMWORKS_READY", true).await;
    // Move into async task from here on
    tokio::spawn(async {
        // Fetch user stats
        let _cb: CallbackHandle = {
            let mut client_guard = STEAMWORKS_CLIENT.lock().await;
            let client = match client_guard.as_mut() {
                Some(client) => client,
                None => {
                    error!("[Core] Steamworks client was expected, but could not be found. Steam-related functionality will likely not be available. Please file a bug report!");
                    return;
                }
            };
            let _cb = client.register_callback(|stats: UserStatsReceived| match stats.result {
                Ok(_) => {
                    tokio::spawn(async {
                        *STEAMWORKS_USER_STATS_FETCHED.lock().await = true;
                    });
                }
                Err(e) => {
                    error!("[Core] Failed to fetch user stats from Steamworks: {e:#?}");
                }
            });
            let steam_id = client.user().steam_id().raw();
            client.user_stats().request_user_stats(steam_id);
            _cb
        };
        // Run steamworks callbacks continuously
        loop {
            {
                // Scoped: this lock is shared with the Steam commands, so it must be
                // released before sleeping.
                let mut client_guard = STEAMWORKS_CLIENT.lock().await;
                if let Some(client) = client_guard.as_mut() {
                    // Run any queued callbacks
                    client.run_callbacks();
                }
            }
            // Sleep
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });
}

use log::error;
use steamworks::{AppId, CallbackHandle, Client, SingleClient, UserStatsReceived};
use tokio::sync::Mutex;

pub mod commands;

pub const STEAM_APP_ID: AppId = AppId(2538150);

lazy_static! {
    pub static ref STEAMWORKS_CLIENT: Mutex<Option<Client>> = Mutex::default();
    pub static ref STEAMWORKS_SINGLE_CLIENT: Mutex<Option<SingleClient>> = Mutex::default();
    pub static ref STEAMWORKS_USER_STATS_FETCHED: Mutex<bool> = Mutex::new(false);
}

pub async fn init() {
    if crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Steam
        && crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::SteamCn
        && crate::BUILD_FLAVOUR != crate::flavour::BuildFlavour::Dev
    {
        return;
    }
    let (client, single) = match Client::init_app(STEAM_APP_ID) {
        Ok((client, single)) => (client, single),
        Err(e) => {
            error!("[Core] Failed to initialize Steamworks client. Steam-related functionality will be disabled. {:#?}", e);
            return;
        }
    };
    // Store the steamworks clients
    *STEAMWORKS_CLIENT.lock().await = Some(client);
    *STEAMWORKS_SINGLE_CLIENT.lock().await = Some(single);
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
                    error!(
                        "[Core] Failed to fetch user stats from Steamworks: {:#?}",
                        e
                    );
                }
            });
            client.user_stats().request_current_stats();
            _cb
        };
        // Run steamworks callbacks continuously
        loop {
            // Get single client for running callbacks
            let mut single_client_guard = STEAMWORKS_SINGLE_CLIENT.lock().await;
            let single = match single_client_guard.as_mut() {
                Some(client) => client,
                None => {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    continue;
                }
            };
            // Run any queued callbacks
            single.run_callbacks();
            // Sleep
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });
}

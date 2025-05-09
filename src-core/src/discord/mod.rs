use std::time::{Duration, SystemTime};

pub use discord_sdk as ds;
use log::error;
use tokio::{sync::Mutex, time::timeout};

pub mod commands;
pub const APP_ID: ds::AppId = 1223302812021035169;

lazy_static! {
    static ref DISCORD_ACTIVE: Mutex<bool> = Mutex::new(false);
    static ref DISCORD_CLIENT: Mutex<Option<Client>> = Default::default();
    static ref LAST_ACTIVITY_UPDATE: Mutex<Option<ActivityUpdate>> = Default::default();
}

pub async fn init() {
    tokio::task::spawn(async {
        loop {
            {
                let res = crate::utils::is_process_active("Discord.exe", false).await;
                let mut discord_active = DISCORD_ACTIVE.lock().await;
                if *discord_active != res {
                    *discord_active = res;
                    drop(discord_active);
                    if res {
                        on_discord_started().await;
                    } else {
                        on_discord_stopped().await;
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

pub async fn on_discord_started() {
    tokio::time::sleep(Duration::from_secs(10)).await;
    // Attempt creating client
    let client = match make_client(ds::Subscriptions::ACTIVITY).await {
        Ok(client) => Some(client),
        Err(err) => {
            error!("[Core] Could not initialize Discord SDK: {}", err);
            None
        }
    };
    // Set client and active status
    {
        *DISCORD_ACTIVE.lock().await = client.is_some();
        *DISCORD_CLIENT.lock().await = client;
    }
    // Try restore the last activity update
    {
        let last_activity_update_guard = LAST_ACTIVITY_UPDATE.lock().await;
        let last_activity_update = last_activity_update_guard.clone();
        drop(last_activity_update_guard);
        if let Some(last_activity_update) = last_activity_update {
            let _ = update_activity(
                last_activity_update.details,
                last_activity_update.state,
                last_activity_update.asset,
                last_activity_update.asset_label,
            )
            .await;
        }
    }
}

pub async fn on_discord_stopped() {
    let client = DISCORD_CLIENT.lock().await.take();
    if let Some(c) = client {
        let _ = c.discord.disconnect();
    }
    *DISCORD_ACTIVE.lock().await = false;
}

#[derive(Clone)]
struct ActivityUpdate {
    details: String,
    state: String,
    asset: String,
    asset_label: Option<String>,
}

pub async fn clear_activity() -> bool {
    *LAST_ACTIVITY_UPDATE.lock().await = None;
    let client_guard = match timeout(Duration::from_secs(2), DISCORD_CLIENT.lock()).await {
        Ok(res) => res,
        Err(_) => return false,
    };
    let client = match client_guard.as_ref() {
        Some(client) => client,
        None => return false,
    };
    
    match timeout(Duration::from_secs(4), client.discord.clear_activity()).await {
        Ok(res) => {
            if let Err(err) = res {
                drop(client_guard);
                match err {
                    ds::Error::NoConnection => on_discord_stopped().await,
                    ds::Error::TimedOut => on_discord_stopped().await,
                    ds::Error::Close(_) => on_discord_stopped().await,
                    ds::Error::CorruptConnection => on_discord_stopped().await,
                    _ => {}
                };
                false
            } else {
                true
            }
        }
        Err(_) => {
            drop(client_guard);
            on_discord_stopped().await;
            false
        }
    }
}

pub async fn update_activity(
    details: String,
    state: String,
    asset: String,
    asset_label: Option<String>,
) -> bool {
    *LAST_ACTIVITY_UPDATE.lock().await = Some(ActivityUpdate {
        details: details.clone(),
        state: state.clone(),
        asset: asset.clone(),
        asset_label: asset_label.clone(),
    });
    let client_guard = match timeout(Duration::from_secs(2), DISCORD_CLIENT.lock()).await {
        Ok(res) => res,
        Err(_) => return false,
    };
    let client = match client_guard.as_ref() {
        Some(client) => client,
        None => return false,
    };
    let rp = ds::activity::ActivityBuilder::default()
        .details(details.as_str())
        .state(state.as_str())
        .assets(ds::activity::Assets::default().large(asset.as_str(), asset_label))
        .button(ds::activity::Button {
            label: "OyasumiVR".to_owned(),
            url: "https://store.steampowered.com/app/2538150/OyasumiVR__VR_Sleeping_Utilities/"
                .to_owned(),
        })
        .start_timestamp(SystemTime::now());
    
    match timeout(Duration::from_secs(4), client.discord.update_activity(rp)).await {
        Ok(res) => {
            if let Err(err) = res {
                drop(client_guard);
                match err {
                    ds::Error::NoConnection => on_discord_stopped().await,
                    ds::Error::TimedOut => on_discord_stopped().await,
                    ds::Error::Close(_) => on_discord_stopped().await,
                    ds::Error::CorruptConnection => on_discord_stopped().await,
                    _ => {}
                };
                false
            } else {
                true
            }
        }
        Err(_) => {
            drop(client_guard);
            on_discord_stopped().await;
            false
        }
    }
}

struct Client {
    pub discord: ds::Discord,
    // pub user: ds::user::User,
    // pub wheel: ds::wheel::Wheel,
}

async fn make_client(subs: ds::Subscriptions) -> Result<Client, String> {
    let (wheel, handler) = ds::wheel::Wheel::new(Box::new(|err| {
        error!("[Core] Could not initialize Discord SDK Client: {}", err);
    }));

    let discord = match ds::Discord::new(ds::DiscordApp::PlainId(APP_ID), subs, Box::new(handler)) {
        Ok(discord) => discord,
        Err(err) => return Err(format!("failed to create Discord client: {}", err)),
    };

    let mut user = wheel.user();
    match user.0.changed().await {
        Ok(_) => {}
        Err(err) => return Err(format!("failed to get user state: {}", err)),
    }
    let _user = match &*user.0.borrow() {
        ds::wheel::UserState::Connected(user) => user.clone(),
        ds::wheel::UserState::Disconnected(err) => {
            return Err(format!("failed to connect to Discord: {}", err))
        }
    };

    Ok(Client {
        discord,
        // user,
        // wheel,
    })
}

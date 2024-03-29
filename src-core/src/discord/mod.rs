use std::time::SystemTime;

pub use discord_sdk as ds;
use log::error;
use tokio::sync::Mutex;

pub mod commands;
pub const APP_ID: ds::AppId = 1223302812021035169;

lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<Client>> = Default::default();
}

pub async fn init() {
    let client = match make_client(ds::Subscriptions::empty()).await {
        Ok(client) => client,
        Err(err) => {
            error!("[Core] Could not initialize Discord SDK: {}", err);
            return;
        }
    };
    *DISCORD_CLIENT.lock().await = Some(client);
}

pub async fn update_activity(
    details: String,
    state: String,
    asset: String,
    asset_label: Option<String>,
) -> bool {
    let client_guard = DISCORD_CLIENT.lock().await;
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
    match client.discord.update_activity(rp).await {
        Ok(_) => true,
        Err(_) => false,
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

    let mut user = wheel.user();

    let discord = match ds::Discord::new(ds::DiscordApp::PlainId(APP_ID), subs, Box::new(handler)) {
        Ok(discord) => discord,
        Err(err) => return Err(format!("failed to create Discord client: {}", err)),
    };

    user.0.changed().await.unwrap();

    let user = match &*user.0.borrow() {
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

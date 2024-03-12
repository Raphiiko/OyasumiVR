use hidapi::HidApi;
use log::error;
use tokio::sync::Mutex;

lazy_static! {
    static ref HIDAPI: Mutex<Option<HidApi>> = Mutex::default();
}

pub mod beyond;

pub async fn init() {
    let api = match HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            error!("[Core] Failed to initialize HIDAPI: {}", e);
            return;
        }
    };
    *HIDAPI.lock().await = Some(api);
}

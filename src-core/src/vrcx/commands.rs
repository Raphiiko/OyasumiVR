use log::debug;

use crate::vrcx::*;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn vrcx_log(msg: String) -> bool {
    let sender = &mut VRCX_NORITICATION_SENDER.lock().unwrap();
    if sender.sender.is_none() && sender.connect().is_err() {
        debug!("[VRCX] failed to connect to VRCX");
        return false;
    }
    if let Err(err) = sender.send_msg(msg.clone()) {
        match err {
            VrcxNotificationSenderError::NotConnected => {
                if sender.connect().is_err() {
                    debug!("[VRCX] failed to connect to VRCX");
                    return false;
                }
                if sender.send_msg(msg).is_err() {
                    debug!("[VRCX] failed to send message to VRCX");
                    return false;
                }
            }
            VrcxNotificationSenderError::SendFailed(_) => {
                debug!("[VRCX] failed to send message to VRCX");
                return false;
            }
            VrcxNotificationSenderError::UnableToConnect(_) => unreachable!(),
        };
    }
    return true;
}

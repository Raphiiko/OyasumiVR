#![allow(dead_code)]
pub mod commands;
pub mod models;
use models::*;
use std::{
    env,
    io::Write,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use log::warn;
use named_pipe::PipeClient;
pub static VRCX_NORITICATION_SENDER: LazyLock<Mutex<NotificationSender>> =
    LazyLock::new(Mutex::default);
#[derive(Default)]
pub struct NotificationSender {
    sender: Option<PipeClient>,
}

impl NotificationSender {
    pub fn connect(&mut self) -> Result<(), VrcxNotificationSenderError> {
        let mut sender = PipeClient::connect_ms(
            get_pipe_path(),
            Duration::from_millis(10).as_millis() as u32,
        )
        .map_err(VrcxNotificationSenderError::UnableToConnect)?;
        sender.set_write_timeout(Some(Duration::from_millis(100)));
        sender.set_read_timeout(Some(Duration::from_millis(100)));
        self.sender = Some(sender);
        Ok(())
    }
    pub fn send_msg(&mut self, msg: String) -> Result<(), VrcxNotificationSenderError> {
        if let Some(sender) = &mut self.sender {
            let msg = VrcxMsg {
                type_: EventType::VrcxMessage,
                msg_type: Some(MessageType::External),
                data: Some(msg),
                notify: false,
                user_id: None,
                display_name: None,
            };
            if let Err(err) =
                sender.write(format!("{}\0", serde_json::to_string(&msg).unwrap()).as_bytes())
            {
                match err.kind() {
                    std::io::ErrorKind::BrokenPipe => {
                        self.sender = None;
                        return Err(VrcxNotificationSenderError::NotConnected);
                    }
                    _ => return Err(VrcxNotificationSenderError::SendFailed(err)),
                };
            }
            Ok(())
        } else {
            Err(VrcxNotificationSenderError::NotConnected)
        }
    }
}
pub fn init() {
    //try to connect
    VRCX_NORITICATION_SENDER.lock().unwrap().connect().ok();
}

fn get_pipe_path() -> String {
    let username_env_name = {
        if cfg!(target_os = "windows") {
            "username".to_string()
        } else {
            "USER".to_string()
        }
    };
    let hash = env::var(&username_env_name)
        .unwrap_or_else(|err| {
            warn!(
                "[VRCX] failed getting '{}' enviroment variable: {:?}",
                username_env_name, err
            );
            "".to_string()
        })
        .chars()
        .map(|x| x as u32)
        .sum::<u32>();
    format!("\\\\.\\pipe\\vrcx-ipc-{}", hash)
}

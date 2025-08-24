#![allow(dead_code)]
pub mod commands;
use std::{
    env,
    io::Write,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use named_pipe::PipeClient;
use serde::Serialize;
pub static VRCX_NORIFICATION_SENDER: LazyLock<Mutex<NotificationSender>> =
    LazyLock::new(Mutex::default);
#[derive(Default)]
pub struct NotificationSender {
    sender: Option<PipeClient>,
}
pub enum VrcxNorificationSenderError {
    UnableToConnect(std::io::Error),
    SendFailed(std::io::Error),
    NotConnected,
}
#[derive(Serialize, Debug)]
enum EventType {
    // OnEvent,
    // OnOperationResponse,
    // OnOperationRequest,
    // VRCEvent,
    // Event7List,
    VrcxMessage,
    // Ping,
    // MsgPing,
    // LaunchCommand,
    // VRCXLaunch,
}
#[derive(Serialize, Debug)]
enum MessageType {
    // CustomTag,
    // ClearCustomTag,
    // Noty,
    External,
}
#[derive(Serialize, Debug)]
struct VrcxMsg {
    #[serde(rename = "type")]
    type_: EventType,
    #[serde(rename = "MsgType")]
    msg_type: Option<MessageType>,
    #[serde(rename = "Data")]
    data: Option<String>,
    // #[serde(rename = "UserId")]
    // user_id: Option<String>,
    // #[serde(rename = "displayName")]
    // display_name: Option<String>,
    notify: bool,
}
impl NotificationSender {
    pub fn connect(&mut self) -> Result<(), VrcxNorificationSenderError> {
        let mut sender = PipeClient::connect_ms(
            get_pipe_path(),
            Duration::from_millis(10).as_millis() as u32,
        )
        .map_err(VrcxNorificationSenderError::UnableToConnect)?;
        sender.set_write_timeout(Some(Duration::from_millis(100)));
        sender.set_read_timeout(Some(Duration::from_millis(100)));
        self.sender = Some(sender);
        Ok(())
    }
    pub fn send_msg(&mut self, msg: String) -> Result<(), VrcxNorificationSenderError> {
        if let Some(sender) = &mut self.sender {
            let msg = VrcxMsg {
                type_: EventType::VrcxMessage,
                msg_type: Some(MessageType::External),
                data: Some(msg),
                notify: false,
            };
            match sender.write(format!("{}\0", serde_json::to_string(&msg).unwrap()).as_bytes()) {
                Ok(_) => {}
                Err(err) => match err.kind() {
                    std::io::ErrorKind::BrokenPipe => {
                        self.sender = None;
                        return Err(VrcxNorificationSenderError::NotConnected);
                    }
                    _ => return Err(VrcxNorificationSenderError::SendFailed(err)),
                },
            };
            Ok(())
        } else {
            return Err(VrcxNorificationSenderError::NotConnected);
        }
    }
}
pub fn init() {
    //try to connect
    VRCX_NORIFICATION_SENDER.lock().unwrap().connect().ok();
}

fn get_pipe_path() -> String {
    let hash = env::var("UserName")
        .unwrap()
        .chars()
        .map(|x| x as u32)
        .sum::<u32>();
    format!("\\\\.\\pipe\\vrcx-ipc-{}", hash)
}

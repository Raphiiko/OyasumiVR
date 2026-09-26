use serde::Serialize;
pub enum VrcxNotificationSenderError {
    UnableToConnect,
    SendFailed,
    NotConnected,
}
#[derive(Serialize, Debug)]
pub enum EventType {
    VrcxMessage,
}
#[derive(Serialize, Debug)]
pub enum MessageType {
    External,
}
#[derive(Serialize, Debug)]
pub struct VrcxMsg {
    #[serde(rename = "type")]
    pub type_: EventType,
    #[serde(rename = "MsgType")]
    pub msg_type: Option<MessageType>,
    #[serde(rename = "Data")]
    pub data: Option<String>,
    #[serde(rename = "UserId")]
    pub user_id: Option<String>,
    #[serde(rename = "DisplayName")]
    pub display_name: Option<String>,
    pub notify: bool,
}

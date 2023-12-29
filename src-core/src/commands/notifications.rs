use std::net::UdpSocket;

#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn xsoverlay_send_message(message: Vec<u8>) {
    let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
    let _ = socket.set_broadcast(true);
    let _ = socket.send_to(&message, "127.0.0.1:42069");
}

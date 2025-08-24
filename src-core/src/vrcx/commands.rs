use crate::vrcx::*;
#[tauri::command]
#[oyasumivr_macros::command_profiling]
pub async fn vrcx_log(msg:String)->bool{
    println!("[VRCX-rust] vrcx_log:{}",msg);
    let sender=&mut VRCX_NORIFICATION_SENDER.lock().unwrap();
    if sender.sender.is_none(){
        if sender.connect().is_err(){
            return false;
        }
    }
    match sender.send_msg(msg.clone()) {
        Ok(_) => {},
        Err(err) => match err{
            VrcxNorificationSenderError::NotConnected=>{
                if sender.connect().is_err() {
                    return false;
                }
                if sender.send_msg(msg).is_err(){
                    return false;
                }
            }
            VrcxNorificationSenderError::SendFailed(_)=> return false,
            VrcxNorificationSenderError::UnableToConnect(_) => unreachable!()
        },
    };
    return true;
}
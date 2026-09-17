use std::{fs, os::windows::process::CommandExt, path::PathBuf, process::Command};

fn directory() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("OyasumiVR/memory-watch"))
}

pub fn start(version: &str, logs: &std::path::Path) {
    if !version.contains("-beta") || oyasumivr_shared::windows::is_elevated() {
        return;
    }
    let Some(directory) = directory() else {
        return;
    };
    if let Err(error) = fs::create_dir_all(&directory) {
        log::warn!("[Memory watch] Could not create diagnostic directory: {error}");
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(created) = creation_time(std::process::id()) else {
        return;
    };
    let helper = exe
        .parent()
        .unwrap()
        .join("resources/memory-watch/oyasumivr-memory-watch.exe");
    let _ = fs::remove_file(directory.join(format!("extra-{}.txt", std::process::id())));
    if let Err(error) = Command::new(helper)
        .args([
            "--watch",
            &std::process::id().to_string(),
            &created.to_string(),
            version,
        ])
        .arg(logs)
        .creation_flags(0x08000000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        log::warn!("[Memory watch] Could not start: {error}");
    }
}

pub fn register_elevated_process(pid: u32) {
    if !env!("CARGO_PKG_VERSION").contains("-beta") {
        return;
    }
    let Some(directory) = directory() else {
        return;
    };
    if let Some(created) = creation_time(pid) {
        let _ = fs::write(
            directory.join(format!("extra-{}.txt", std::process::id())),
            format!("{pid} {created}"),
        );
    }
}

fn creation_time(pid: u32) -> Option<u64> {
    use windows::Win32::{Foundation::FILETIME, System::Threading::*};
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let (mut created, mut exited, mut kernel, mut user) = (
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
            );
            let success =
                GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).is_ok();
            let _ = windows::Win32::Foundation::CloseHandle(handle);
            if success {
                return Some(
                    ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
                );
            }
        }
    }
    None
}

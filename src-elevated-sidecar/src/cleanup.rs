use oyasumivr_shared::task;
use oyasumivr_shared::windows::{current_user_sid, is_elevated};
use std::path::Path;
use std::process::Command;

const LAUNCHER_EXE: &str = "oyasumivr-privileged-launcher.exe";
const LAUNCHER_MARKER: &str = "launcher.json";

pub fn remove_privileged_launcher() -> Result<(), String> {
    if !is_elevated() {
        return Err("the elevated sidecar is not running with administrator access".to_string());
    }
    let sid = current_user_sid().map_err(|e| format!("cannot read the current user SID: {e}"))?;
    let dir = oyasumivr_shared::windows::program_files()
        .map_err(|e| format!("cannot resolve Program Files: {e}"))?
        .join("OyasumiVR")
        .join("privileged");
    let task_result =
        task::unregister(&sid).map_err(|e| format!("cannot delete the scheduled task: {e}"));
    if !dir.exists() {
        return task_result.map(|_| ());
    }
    finish_cleanup(task_result, remove_at(&dir, spawn_directory_removal))
}

fn remove_at(
    dir: &Path,
    schedule_removal: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let results = [
        remove_file_if_present(&dir.join(LAUNCHER_MARKER)),
        remove_file_if_present(&dir.join(LAUNCHER_EXE)),
        schedule_removal(dir),
    ];
    collect_errors(results)
}

fn finish_cleanup(
    task_result: Result<bool, String>,
    artifact_result: Result<(), String>,
) -> Result<(), String> {
    collect_errors([task_result.map(|_| ()), artifact_result])
}

fn collect_errors<const N: usize>(results: [Result<(), String>; N]) -> Result<(), String> {
    let errors: Vec<_> = results.into_iter().filter_map(Result::err).collect();
    match errors.is_empty() {
        true => Ok(()),
        false => Err(errors.join("; ")),
    }
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete {}: {e}", path.display())),
    }
}

fn spawn_directory_removal(dir: &Path) -> Result<(), String> {
    spawn_directory_removal_after(std::process::id(), dir)
}

fn spawn_directory_removal_after(pid: u32, dir: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    let system = system_directory()?;
    let powershell = system.join("WindowsPowerShell/v1.0/powershell.exe");
    if !powershell.is_file() {
        return Err(format!("cannot find {}", powershell.display()));
    }
    let script = removal_script(pid, dir);
    Command::new(&powershell)
        .current_dir(system)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot start the cleanup process: {e}"))
}

fn system_directory() -> Result<std::path::PathBuf, String> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;

    let mut buffer = vec![0u16; 261];
    let mut length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
    if length == 0 {
        return Err("Windows did not return its system directory".to_string());
    }
    if length as usize >= buffer.len() {
        buffer.resize(length as usize + 1, 0);
        length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if length == 0 || length as usize >= buffer.len() {
            return Err("Windows returned an invalid system directory".to_string());
        }
    }
    Ok(std::path::PathBuf::from(String::from_utf16_lossy(
        &buffer[..length as usize],
    )))
}

fn removal_script(pid: u32, dir: &Path) -> String {
    let literal = dir.display().to_string().replace('\'', "''");
    format!(
        "$process = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($process) {{ $process.WaitForExit() }}; Remove-Item -LiteralPath '{literal}' -Recurse -Force"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cleanup_removes_the_launcher_and_defers_the_staged_sidecar() {
        let dir = scratch("oyasumi-elevated-cleanup");
        std::fs::write(dir.join(LAUNCHER_MARKER), b"marker").unwrap();
        std::fs::write(dir.join(LAUNCHER_EXE), b"launcher").unwrap();
        let staged = dir.join("staged");
        std::fs::create_dir_all(&staged).unwrap();

        let mut scheduled = false;
        remove_at(&dir, |_| {
            scheduled = true;
            Ok(())
        })
        .unwrap();

        assert!(!dir.join(LAUNCHER_MARKER).exists());
        assert!(!dir.join(LAUNCHER_EXE).exists());
        assert!(scheduled);
        assert!(
            staged.is_dir(),
            "the running sidecar cache must stay intact"
        );
    }

    #[test]
    fn scheduling_failure_reports_the_partial_cleanup() {
        let dir = scratch("oyasumi-elevated-cleanup-task-failure");
        std::fs::write(dir.join(LAUNCHER_MARKER), b"marker").unwrap();
        std::fs::write(dir.join(LAUNCHER_EXE), b"launcher").unwrap();

        let error = remove_at(&dir, |_| Err("helper refused to start".to_string())).unwrap_err();

        assert_eq!(error, "helper refused to start");
        assert!(!dir.join(LAUNCHER_MARKER).exists());
        assert!(!dir.join(LAUNCHER_EXE).exists());
    }

    #[test]
    fn task_failure_does_not_skip_artifact_cleanup() {
        let error = finish_cleanup(
            Err("task refused deletion".to_string()),
            Err("directory removal failed".to_string()),
        )
        .unwrap_err();

        assert_eq!(error, "task refused deletion; directory removal failed");
    }

    #[test]
    fn one_file_failure_does_not_skip_the_remaining_cleanup() {
        let dir = scratch("oyasumi-elevated-cleanup-file-failure");
        std::fs::create_dir_all(dir.join(LAUNCHER_MARKER)).unwrap();
        std::fs::write(dir.join(LAUNCHER_EXE), b"launcher").unwrap();
        let mut scheduled = false;

        let error = remove_at(&dir, |_| {
            scheduled = true;
            Ok(())
        })
        .unwrap_err();

        assert!(error.contains("launcher.json"), "{error}");
        assert!(!dir.join(LAUNCHER_EXE).exists());
        assert!(scheduled);
    }

    #[test]
    fn powershell_receives_a_literal_cleanup_path() {
        let script = removal_script(42, Path::new(r"C:\Program Files\O'Brien\privileged"));
        assert!(script.contains("Get-Process -Id 42"));
        assert!(script.contains("-LiteralPath 'C:\\Program Files\\O''Brien\\privileged'"));
    }

    #[test]
    fn system_cleanup_process_removes_a_directory() {
        let dir = scratch("oyasumi-elevated-cleanup-process");
        std::fs::write(dir.join("artifact"), b"x").unwrap();

        spawn_directory_removal_after(2_000_000_000, &dir).unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while dir.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            !dir.exists(),
            "the cleanup process did not remove the directory"
        );
    }

    #[test]
    fn system_cleanup_process_escapes_the_sidecar_directory() {
        const CHILD_DIR: &str = "OYASUMIVR_CLEANUP_TEST_CHILD_DIR";
        if let Some(dir) = std::env::var_os(CHILD_DIR) {
            spawn_directory_removal_after(2_000_000_000, Path::new(&dir)).unwrap();
            return;
        }

        let dir = scratch("oyasumi-elevated-cleanup-working-directory");
        let staged = dir.join("staged");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("artifact"), b"x").unwrap();
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cleanup::tests::system_cleanup_process_escapes_the_sidecar_directory",
            ])
            .env(CHILD_DIR, &dir)
            .current_dir(&staged)
            .status()
            .unwrap();
        assert!(status.success());

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while dir.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(!dir.exists(), "cleanup inherited the sidecar directory");
    }
}

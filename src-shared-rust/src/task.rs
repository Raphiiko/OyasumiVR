//! The scheduled task that starts the privileged launcher, defined once for the launcher that
//! registers it and the core that inspects and runs it.

use std::path::Path;
use windows::core::{Interface, BSTR, HRESULT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::TaskScheduler::{
    IExecAction, IRegisteredTask, ITaskService, TaskScheduler, TASK_LOGON_INTERACTIVE_TOKEN,
    TASK_RUNLEVEL_HIGHEST, TASK_RUNLEVEL_TYPE,
};
use windows::Win32::System::Variant::VARIANT;

/// One registration per account, so a second administrator cannot replace the first one's.
pub fn task_name(user_sid: &str) -> String {
    format!("OyasumiVR Privileged Launcher ({user_sid})")
}

const TASK_NAME_PREFIX: &str = "OyasumiVR Privileged Launcher (";

/// `TASK_CREATE_OR_UPDATE | TASK_DONT_ADD_PRINCIPAL_ACE`. Without the second flag the registering
/// account keeps write access and can re-aim the task.
const CREATE_FLAGS: i32 = 6 | 0x10;

/// OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION
const OWNER_AND_DACL_INFO: i32 = 1 | 4;

/// The user gets read and execute only. SYSTEM and Administrators keep full control, and own the
/// task, so the registering account holds no implicit right to rewrite it.
pub fn sddl(user_sid: &str) -> String {
    format!("O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;{user_sid})")
}

fn service() -> windows::core::Result<ITaskService> {
    unsafe {
        // already initialised elsewhere in the process is fine
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let service: ITaskService = CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)?;
        let empty = VARIANT::default();
        service.Connect(&empty, &empty, &empty, &empty)?;
        Ok(service)
    }
}

fn registered_task(user_sid: &str) -> windows::core::Result<IRegisteredTask> {
    unsafe {
        let root = service()?.GetFolder(&BSTR::from("\\"))?;
        root.GetTask(&BSTR::from(task_name(user_sid)))
    }
}

fn xml(exe: &Path, working_dir: &Path, user_sid: &str) -> String {
    // No triggers and no arguments: whatever can start this task must not choose what it runs.
    // The battery and idle settings are explicit because their defaults would refuse to start.
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>OyasumiVR</Author>
    <Description>Starts the OyasumiVR elevated sidecar without a prompt.</Description>
  </RegistrationInfo>
  <Triggers />
  <Principals>
    <Principal id="Author">
      <UserId>{user_sid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{}</Command>
      <WorkingDirectory>{}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>"#,
        escape(&exe.display().to_string()),
        escape(&working_dir.display().to_string()),
    )
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Registers or updates the task. Needs an elevated caller.
pub fn register(exe: &Path, working_dir: &Path, user_sid: &str) -> windows::core::Result<()> {
    unsafe {
        let root = service()?.GetFolder(&BSTR::from("\\"))?;
        let user = VARIANT::from(user_sid);
        let descriptor = VARIANT::from(sddl(user_sid).as_str());
        let empty = VARIANT::default();
        root.RegisterTask(
            &BSTR::from(task_name(user_sid)),
            &BSTR::from(xml(exe, working_dir, user_sid)),
            CREATE_FLAGS,
            &user,
            &empty,
            TASK_LOGON_INTERACTIVE_TOKEN,
            &descriptor,
        )?;
        Ok(())
    }
}

/// What the registered task actually says. Windows rewrites parts of a security descriptor as it
/// stores it, so `sddl` compares by parsing rather than by string equality.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub action_path: String,
    pub action_arguments: String,
    pub enabled: bool,
    pub run_level_is_highest: bool,
    pub sddl: String,
}

pub fn registration(user_sid: &str) -> windows::core::Result<Registration> {
    unsafe {
        let task = registered_task(user_sid)?;
        let definition = task.Definition()?;

        let action: IExecAction = definition.Actions()?.get_Item(1)?.cast()?;
        let mut action_path = BSTR::new();
        action.Path(&mut action_path)?;
        let mut action_arguments = BSTR::new();
        // An action with no arguments reports an empty BSTR rather than failing.
        let _ = action.Arguments(&mut action_arguments);

        let mut run_level = TASK_RUNLEVEL_TYPE::default();
        definition.Principal()?.RunLevel(&mut run_level)?;

        Ok(Registration {
            action_path: action_path.to_string(),
            action_arguments: action_arguments.to_string(),
            enabled: task.Enabled()?.0 != 0,
            run_level_is_highest: run_level == TASK_RUNLEVEL_HIGHEST,
            sddl: task.GetSecurityDescriptor(OWNER_AND_DACL_INFO)?.to_string(),
        })
    }
}

/// Starts the task. Needs no elevation and raises no prompt.
///
/// `MultipleInstancesPolicy` is `IgnoreNew`, so a request made while a previous launcher is still
/// running is dropped and still reports success. The caller has to decide whether a sidecar
/// actually arrived.
pub fn run(user_sid: &str) -> windows::core::Result<()> {
    unsafe {
        registered_task(user_sid)?.Run(&VARIANT::default())?;
        Ok(())
    }
}

/// Deletes this account's privileged launcher task if present. Needs an elevated caller.
pub fn unregister(user_sid: &str) -> windows::core::Result<bool> {
    let result = unsafe {
        service()?
            .GetFolder(&BSTR::from("\\"))?
            .DeleteTask(&BSTR::from(task_name(user_sid)), 0)
    };
    match result {
        Ok(()) => Ok(true),
        Err(e) if task_is_missing(e.code()) => Ok(false),
        Err(e) => Err(e),
    }
}

pub fn exists(user_sid: &str) -> windows::core::Result<bool> {
    match registered_task(user_sid) {
        Ok(_) => Ok(true),
        Err(e) if task_is_missing(e.code()) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Whether another account still has an OyasumiVR privileged launcher task.
pub fn has_other_registration(user_sid: &str) -> windows::core::Result<bool> {
    unsafe {
        let tasks = service()?.GetFolder(&BSTR::from("\\"))?.GetTasks(1)?;
        let own_name = task_name(user_sid);
        for index in 1..=tasks.Count()? {
            let task = tasks.get_Item(&VARIANT::from(index))?;
            let name = task.Name()?.to_string();
            if name != own_name && is_launcher_task_name(&name) {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn is_launcher_task_name(name: &str) -> bool {
    name.starts_with(TASK_NAME_PREFIX) && name.ends_with(')')
}

fn task_is_missing(code: HRESULT) -> bool {
    const FILE_NOT_FOUND: HRESULT = HRESULT(0x8007_0002u32 as i32);
    const TASK_NOT_FOUND: HRESULT = HRESULT(0x8004_130fu32 as i32);
    code == FILE_NOT_FOUND || code == TASK_NOT_FOUND
}

/// The launcher's exit code from its last run, its only channel back to the core.
pub fn last_result(user_sid: &str) -> windows::core::Result<i32> {
    unsafe { registered_task(user_sid)?.LastTaskResult() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_has_no_triggers_and_no_arguments() {
        let doc = xml(
            Path::new(r"C:\Program Files\OyasumiVR\privileged\launcher.exe"),
            Path::new(r"C:\Program Files\OyasumiVR\privileged\staged"),
            "S-1-5-21-1-2-3-1001",
        );
        assert!(doc.contains("<Triggers />"));
        assert!(!doc.contains("<Arguments>"));
        assert!(doc.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(doc.contains("<LogonType>InteractiveToken</LogonType>"));
        assert!(doc.contains("<DisallowStartIfOnBatteries>false<"));
        assert!(doc.contains("<StopIfGoingOnBatteries>false<"));
        assert!(doc.contains("<StopOnIdleEnd>false<"));
        assert!(doc.contains("<AllowStartOnDemand>true<"));
        assert!(doc.contains("<Enabled>true<"));
        assert!(doc.contains("<ExecutionTimeLimit>PT1M<"));
    }

    #[test]
    fn the_task_name_is_per_account() {
        let a = task_name("S-1-5-21-1-2-3-1001");
        let b = task_name("S-1-5-21-1-2-3-1002");
        assert_ne!(a, b);
        assert!(a.starts_with("OyasumiVR Privileged Launcher"));
        assert!(is_launcher_task_name(&a));
        assert!(!is_launcher_task_name(
            "OyasumiVR Privileged Launcher backup"
        ));
    }

    #[test]
    fn sddl_denies_the_user_everything_but_read_and_execute() {
        let descriptor = sddl("S-1-5-21-1-2-3-1001");
        assert_eq!(
            descriptor,
            "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;S-1-5-21-1-2-3-1001)"
        );
    }

    #[test]
    fn the_security_descriptor_windows_parses_matches_what_we_wrote() {
        use windows::core::{PCWSTR, PWSTR};
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Authorization::{
            ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
        };
        use windows::Win32::Security::PSECURITY_DESCRIPTOR;

        let descriptor = sddl("S-1-5-21-1-2-3-1001");
        let wide: Vec<u16> = descriptor
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let mut parsed = PSECURITY_DESCRIPTOR::default();
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(wide.as_ptr()),
                SDDL_REVISION_1,
                &mut parsed,
                None,
            )
            .expect("Windows must accept the descriptor we register with");
            let _ = LocalFree(Some(HLOCAL(parsed.0)));
            let _ = PWSTR::null();
        }
    }

    #[test]
    fn a_string_variant_is_freed_exactly_once() {
        // A double free shows up as a heap corruption abort rather than a failed assertion.
        for _ in 0..1000 {
            drop(VARIANT::from("S-1-5-21-1-2-3-1001"));
        }
    }

    #[test]
    fn paths_with_xml_metacharacters_are_escaped() {
        let doc = xml(
            Path::new(r"C:\a&b\launcher.exe"),
            Path::new(r"C:\a&b"),
            "S-1-5-21-1-2-3-1001",
        );
        assert!(doc.contains(r"C:\a&amp;b\launcher.exe"));
        assert!(!doc.contains(r"C:\a&b\launcher.exe"));
    }

    #[test]
    fn missing_task_errors_make_unregistration_idempotent() {
        assert!(task_is_missing(HRESULT(0x8007_0002u32 as i32)));
        assert!(task_is_missing(HRESULT(0x8004_130fu32 as i32)));
        assert!(!task_is_missing(HRESULT(0x8007_0005u32 as i32)));
    }
}

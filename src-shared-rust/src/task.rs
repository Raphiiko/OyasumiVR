//! The scheduled task that starts the privileged launcher, defined once for the launcher that
//! registers it and the core that inspects and runs it.

use std::mem::ManuallyDrop;
use std::path::Path;
use windows::core::{BSTR, Interface};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::TaskScheduler::{
    IExecAction, IRegisteredTask, ITaskService, TaskScheduler, TASK_LOGON_INTERACTIVE_TOKEN,
    TASK_RUNLEVEL_HIGHEST, TASK_RUNLEVEL_TYPE,
};
use windows::Win32::System::Variant::{VARIANT, VT_BSTR};

/// One registration per account, so a second administrator cannot replace the first one's.
pub fn task_name(user_sid: &str) -> String {
    format!("OyasumiVR Privileged Launcher ({user_sid})")
}

/// `TASK_CREATE_OR_UPDATE | TASK_DONT_ADD_PRINCIPAL_ACE`. Without the second flag the registering
/// account keeps write access and can re-aim the task.
const CREATE_FLAGS: i32 = 6 | 0x10;

/// DACL_SECURITY_INFORMATION
const DACL_INFO: i32 = 4;

/// The user gets read and execute only. SYSTEM and Administrators keep full control.
pub fn sddl(user_sid: &str) -> String {
    format!("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;{user_sid})")
}

/// A VARIANT holding a BSTR, freed on drop.
struct BstrVariant(VARIANT);

impl BstrVariant {
    fn new(value: &str) -> Self {
        let mut variant = VARIANT::default();
        unsafe {
            let inner = &mut *variant.Anonymous.Anonymous;
            inner.vt = VT_BSTR;
            inner.Anonymous.bstrVal = ManuallyDrop::new(BSTR::from(value));
        }
        Self(variant)
    }
}

impl Drop for BstrVariant {
    fn drop(&mut self) {
        unsafe {
            let inner = &mut *self.0.Anonymous.Anonymous;
            ManuallyDrop::drop(&mut inner.Anonymous.bstrVal);
        }
    }
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
        let user = BstrVariant::new(user_sid);
        let descriptor = BstrVariant::new(&sddl(user_sid));
        let empty = VARIANT::default();
        root.RegisterTask(
            &BSTR::from(task_name(user_sid)),
            &BSTR::from(xml(exe, working_dir, user_sid)),
            CREATE_FLAGS,
            &user.0,
            &empty,
            TASK_LOGON_INTERACTIVE_TOKEN,
            &descriptor.0,
        )?;
        Ok(())
    }
}

/// What the registered task actually says, for the core to compare against what it expects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub action_path: String,
    pub action_arguments: String,
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
            run_level_is_highest: run_level == TASK_RUNLEVEL_HIGHEST,
            sddl: task.GetSecurityDescriptor(DACL_INFO)?.to_string(),
        })
    }
}

/// Starts the task. Needs no elevation and raises no prompt.
pub fn run(user_sid: &str) -> windows::core::Result<()> {
    unsafe {
        registered_task(user_sid)?.Run(&VARIANT::default())?;
        Ok(())
    }
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
        assert!(doc.contains("<ExecutionTimeLimit>PT1M<"));
    }

    #[test]
    fn the_task_name_is_per_account() {
        let a = task_name("S-1-5-21-1-2-3-1001");
        let b = task_name("S-1-5-21-1-2-3-1002");
        assert_ne!(a, b);
        assert!(a.starts_with("OyasumiVR Privileged Launcher"));
    }

    #[test]
    fn sddl_denies_the_user_everything_but_read_and_execute() {
        let descriptor = sddl("S-1-5-21-1-2-3-1001");
        assert_eq!(
            descriptor,
            "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;S-1-5-21-1-2-3-1001)"
        );
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
}

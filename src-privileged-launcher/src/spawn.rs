use std::io::{Error, Result};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
    UpdateProcThreadAttribute, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
    EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
    PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY, STARTUPINFOEXW,
};
use windows::core::PWSTR;

/// `PROCESS_CREATION_MITIGATION_POLICY_IMAGE_LOAD_PREFER_SYSTEM32_ALWAYS_ON`. Bit 60, so the
/// attribute value must be a u64; a u32 silently drops the flag.
const PREFER_SYSTEM32: u64 = 1 << 60;

fn wide(value: &Path) -> Vec<u16> {
    value
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Starts the sidecar from its staged, admin-only directory. A failure to set the mitigation
/// policy is not fatal, since the directory permissions are what stop DLL planting.
pub fn start(exe: &Path, working_dir: &Path) -> Result<u32> {
    let mut application = wide(exe);
    let mut directory = wide(working_dir);

    unsafe {
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;

        let mut size = 0usize;
        // The first call always fails. It only reports the buffer size.
        let _ = InitializeProcThreadAttributeList(None, 1, None, &mut size);
        let mut buffer = vec![0u8; size];
        let list = LPPROC_THREAD_ATTRIBUTE_LIST(buffer.as_mut_ptr() as *mut _);

        let mut policy = PREFER_SYSTEM32;
        let mut flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
        let mut attributes_ready = false;

        if InitializeProcThreadAttributeList(Some(list), 1, None, &mut size).is_ok()
            && UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY as usize,
                Some(&mut policy as *mut u64 as *const _),
                std::mem::size_of::<u64>(),
                None,
                None,
            )
            .is_ok()
        {
            startup.lpAttributeList = list;
            flags |= EXTENDED_STARTUPINFO_PRESENT;
            attributes_ready = true;
        }

        let mut information = PROCESS_INFORMATION::default();
        let result = CreateProcessW(
            PWSTR(application.as_mut_ptr()),
            None,
            None,
            None,
            false,
            flags,
            None,
            PWSTR(directory.as_mut_ptr()),
            &startup.StartupInfo,
            &mut information,
        );

        if attributes_ready {
            DeleteProcThreadAttributeList(list);
        }

        result.map_err(|e| Error::from_raw_os_error(e.code().0))?;

        // the sidecar outlives this process on purpose
        let _ = CloseHandle(information.hThread);
        let _ = CloseHandle(information.hProcess);
        let _ = HANDLE::default();
        Ok(information.dwProcessId)
    }
}

use crate::{Identity, Process, GIB};
use std::{
    fs::File,
    io,
    mem::size_of,
    os::windows::{ffi::OsStrExt, io::AsRawHandle},
    path::Path,
    ptr::null_mut,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Storage::FileSystem::GetDiskFreeSpaceExW,
    System::{
        Diagnostics::{Debug::*, ToolHelp::*},
        ProcessStatus::*,
        Threading::*,
    },
    UI::WindowsAndMessaging::*,
};

pub struct Handle(pub HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

pub fn open(pid: u32, access: u32) -> io::Result<Handle> {
    let handle = unsafe { OpenProcess(access, 0, pid) };
    if handle.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok(Handle(handle))
    }
}

pub fn identity(pid: u32) -> io::Result<Identity> {
    let handle = open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
    created(&handle).map(|created| Identity { pid, created })
}

fn created(handle: &Handle) -> io::Result<u64> {
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    if unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user) } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
}

pub fn root_handle(id: Identity) -> io::Result<Handle> {
    let handle = open(id.pid, PROCESS_QUERY_LIMITED_INFORMATION | 0x00100000)?;
    if created(&handle)? != id.created {
        return Err(io::Error::other("process identity changed"));
    }
    Ok(handle)
}

pub fn alive(handle: &Handle) -> bool {
    unsafe { WaitForSingleObject(handle.0, 0) == WAIT_TIMEOUT }
}

pub fn snapshot() -> io::Result<Vec<Process>> {
    let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if raw == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let snapshot = Handle(raw);
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut processes = Vec::new();
    let mut success = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while success != 0 {
        let len = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        let mut process = Process {
            id: Identity {
                pid: entry.th32ProcessID,
                created: 0,
            },
            parent: entry.th32ParentProcessID,
            name: String::from_utf16_lossy(&entry.szExeFile[..len]),
            private: None,
            resident: None,
            error: None,
        };
        match open(process.id.pid, PROCESS_QUERY_LIMITED_INFORMATION)
            .and_then(|handle| created(&handle))
        {
            Ok(created) => process.id.created = created,
            Err(error) => process.error = Some(error.to_string()),
        }
        processes.push(process);
        success = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    Ok(processes)
}

pub fn measure(process: &mut Process) {
    let result = (|| {
        let handle = open(process.id.pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
        if created(&handle)? != process.id.created {
            return Err(io::Error::other("process identity changed"));
        }
        let mut counters = PROCESS_MEMORY_COUNTERS_EX {
            cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            ..Default::default()
        };
        if unsafe {
            K32GetProcessMemoryInfo(
                handle.0,
                &mut counters as *mut _ as *mut PROCESS_MEMORY_COUNTERS,
                counters.cb,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        process.private = Some(counters.PrivateUsage as u64);
        process.resident = Some(counters.WorkingSetSize as u64);
        Ok(())
    })();
    if let Err(error) = result {
        process.error = Some(error.to_string());
    }
}

pub fn free_space(directory: &Path) -> io::Result<u64> {
    let mut available = 0;
    if unsafe {
        GetDiskFreeSpaceExW(
            wide(directory).as_ptr(),
            &mut available,
            null_mut(),
            null_mut(),
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(available)
    }
}

struct Budget<'a> {
    file: &'a File,
    directory: &'a Path,
    started: Instant,
    cancelled: bool,
}

unsafe extern "system" fn dump_callback(
    context: *mut std::ffi::c_void,
    input: *const MINIDUMP_CALLBACK_INPUT,
    output: *mut MINIDUMP_CALLBACK_OUTPUT,
) -> i32 {
    if (*input).CallbackType == CancelCallback as u32 {
        let budget = &mut *(context as *mut Budget);
        budget.cancelled |= budget.started.elapsed() > Duration::from_secs(120)
            || budget
                .file
                .metadata()
                .map_or(true, |metadata| metadata.len() >= 8 * GIB)
            || free_space(budget.directory).map_or(true, |space| space < GIB / 2);
        (*output).Anonymous.Anonymous2 = MINIDUMP_CALLBACK_OUTPUT_0_1 {
            CheckCancel: 1,
            Cancel: budget.cancelled as i32,
        };
    }
    1
}

pub fn dump(id: Identity, destination: &Path) -> io::Result<()> {
    let process = open(id.pid, PROCESS_QUERY_INFORMATION | PROCESS_VM_READ)?;
    if created(&process)? != id.created {
        return Err(io::Error::other("process exited or PID was reused"));
    }
    let file = File::options()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut budget = Budget {
        file: &file,
        directory: destination.parent().unwrap(),
        started: Instant::now(),
        cancelled: false,
    };
    let callbacks = MINIDUMP_CALLBACK_INFORMATION {
        CallbackRoutine: Some(dump_callback),
        CallbackParam: &mut budget as *mut _ as *mut _,
    };
    let result = unsafe {
        MiniDumpWriteDump(
            process.0,
            id.pid,
            file.as_raw_handle(),
            MiniDumpWithFullMemory
                | MiniDumpWithFullMemoryInfo
                | MiniDumpWithThreadInfo
                | MiniDumpWithUnloadedModules,
            std::ptr::null(),
            std::ptr::null(),
            &callbacks,
        )
    };
    if result == 0 {
        if budget.cancelled {
            Err(io::Error::other(
                "capture cancelled: time, disk space or dump size budget exceeded",
            ))
        } else {
            Err(io::Error::last_os_error())
        }
    } else {
        file.sync_all()
    }
}

pub fn message(text: &str, question: bool) -> bool {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(text).as_ptr(),
            wide(crate::text("title")).as_ptr(),
            MB_SETFOREGROUND | MB_ICONINFORMATION | if question { MB_YESNO } else { MB_OK },
        ) == IDYES
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_dump_requests_cooperative_cancellation() {
        let path =
            std::env::temp_dir().join(format!("oyasumivr-dump-budget-{}.tmp", std::process::id()));
        let file = File::create(&path).unwrap();
        let mut budget = Budget {
            file: &file,
            directory: path.parent().unwrap(),
            started: Instant::now() - Duration::from_secs(121),
            cancelled: false,
        };
        let input = MINIDUMP_CALLBACK_INPUT {
            CallbackType: CancelCallback as u32,
            ..Default::default()
        };
        let mut output = MINIDUMP_CALLBACK_OUTPUT::default();
        unsafe {
            assert_eq!(
                dump_callback(&mut budget as *mut _ as *mut _, &input, &mut output),
                1
            );
            let cancellation = output.Anonymous.Anonymous2;
            assert_eq!(cancellation.CheckCancel, 1);
            assert_eq!(cancellation.Cancel, 1);
        }
        drop(file);
        std::fs::remove_file(path).unwrap();
    }
}

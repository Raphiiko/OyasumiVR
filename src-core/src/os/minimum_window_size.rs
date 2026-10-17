use log::warn;
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            IsIconic, SM_CXMINTRACK, SM_CYMINTRACK, SWP_NOSIZE, WINDOWPOS, WM_NCDESTROY,
            WM_WINDOWPOSCHANGING,
        },
    },
};

const SUBCLASS_ID: usize = 1;

/// Keeps a window at least the smallest size Windows lets a user drag it to, whoever resizes it.
///
/// Tauri panics when it repaints a transparent undecorated window that is smaller than its
/// frame insets. Call this on the thread that owns the window.
pub fn enforce(window: &tauri::WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(error) => {
            warn!(
                "[Core] Could not get the {} window handle: {error}",
                window.label()
            );
            return;
        }
    };
    if !unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) }.as_bool() {
        warn!(
            "[Core] Could not enforce a minimum size on the {} window",
            window.label()
        );
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            let pos = &mut *(lparam.0 as *mut WINDOWPOS);
            if !pos.flags.contains(SWP_NOSIZE) && !IsIconic(hwnd).as_bool() {
                let dpi = GetDpiForWindow(hwnd);
                pos.cx = pos.cx.max(GetSystemMetricsForDpi(SM_CXMINTRACK, dpi));
                pos.cy = pos.cy.max(GetSystemMetricsForDpi(SM_CYMINTRACK, dpi));
            }
        }
        WM_NCDESTROY => {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), id);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

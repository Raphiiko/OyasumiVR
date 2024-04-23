use std::os::windows::ffi::OsStrExt;
use std::{ffi::OsStr, iter::once};

use hidapi::HidApi;
use log::error;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use winapi::shared::minwindef::{LPARAM, LRESULT, UINT, WPARAM};
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::winuser::{
    DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW, PostQuitMessage,
    SetWindowLongPtrW, TranslateMessage, GWLP_USERDATA, MSG, WM_CREATE, WM_DESTROY,
    WM_DEVICECHANGE,
};
use winapi::{
    shared::{
        ntdef::LPCWSTR,
        windef::{HBRUSH, HCURSOR, HICON, HWND},
    },
    um::winuser::{CreateWindowExW, RegisterClassW, WNDCLASSW},
};

pub enum PnPDetectorEvent {
    Plug { device_ref: PnPDetectorDevice },
    Unplug { device_ref: PnPDetectorDevice },
}

#[derive(PartialEq, Clone)]
pub struct PnPDetectorDevice {
    pub vid: u16,
    pub pid: u16,
}

pub struct PnPDetector {
    hwnd: HWND,
    hidapi: HidApi,
    tx: UnboundedSender<PnPDetectorEvent>,
    known_devices: Vec<PnPDetectorDevice>,
}

impl PnPDetector {
    pub fn start() -> UnboundedReceiver<PnPDetectorEvent> {
        let (tx, rx) = unbounded_channel::<PnPDetectorEvent>();
        tokio::task::spawn_blocking(move || {
            let hidapi = match HidApi::new() {
                Ok(a) => a,
                Err(e) => {
                    error!("[Core] Failed to initialize HIDAPI: {}", e);
                    return;
                }
            };
            let mut detector = Self {
                hwnd: std::ptr::null_mut(),
                hidapi,
                tx,
                known_devices: Vec::new(),
            };
            detector.create_window();
            detector.list_devices(false);
            detector.detect();
        });
        rx
    }

    fn handle_hotplug_event(&mut self) {
        self.list_devices(true);
    }

    fn list_devices(&mut self, emit_events: bool) {
        let _ = self.hidapi.refresh_devices();
        // Check for added devices
        let devices = self.hidapi.device_list();
        for device_info in devices {
            // Check if device already in known devices
            let device = PnPDetectorDevice {
                vid: device_info.vendor_id(),
                pid: device_info.product_id(),
            };
            if self.known_devices.contains(&device) {
                continue;
            }
            // Add device to known devices
            self.known_devices.push(device.clone());
            // Emit event
            if emit_events {
                self.tx
                    .send(PnPDetectorEvent::Plug {
                        device_ref: device.clone(),
                    })
                    .unwrap();
            }
        }
        // Check for removed devices
        let mut removed_devices = Vec::new();
        for known_device in &self.known_devices {
            let mut found = false;
            let devices = self.hidapi.device_list();
            for device_info in devices {
                let device = PnPDetectorDevice {
                    vid: device_info.vendor_id(),
                    pid: device_info.product_id(),
                };
                if known_device == &device {
                    found = true;
                    break;
                }
            }
            if !found {
                removed_devices.push(known_device.clone());
            }
        }
        for removed_device in removed_devices {
            self.known_devices.retain(|d| d != &removed_device);
            // Emit event
            if emit_events {
                self.tx
                    .send(PnPDetectorEvent::Unplug {
                        device_ref: removed_device,
                    })
                    .unwrap();
            }
        }
    }

    /// Detect USB events: just run a Windows event loop
    fn detect(&self) {
        unsafe {
            let mut msg: MSG = std::mem::MaybeUninit::zeroed().assume_init();
            loop {
                let val = GetMessageW(&mut msg, self.hwnd, 0, 0);
                if val == 0 {
                    break;
                } else {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
    }

    /// Window procedure function to handle events
    pub unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: UINT,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_CREATE => {
                let create_struct = lparam as *mut winapi::um::winuser::CREATESTRUCTW;
                let window_state_ptr = create_struct.as_ref().unwrap().lpCreateParams;
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, window_state_ptr as isize);
            }
            WM_DESTROY => {
                PostQuitMessage(0);
            }
            WM_DEVICECHANGE => {
                let self_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
                let window_state: &mut Self = &mut *(self_ptr as *mut Self);
                window_state.handle_hotplug_event();
            }
            _ => return DefWindowProcW(hwnd, msg, wparam, lparam),
        }
        return 0;
    }

    /// Create an invisible window to handle WM_DEVICECHANGE message
    fn create_window(&mut self) {
        let winapi_class_name: Vec<u16> = OsStr::new("OyasumiVRPnPDetectWindowClass")
            .encode_wide()
            .chain(once(0))
            .collect();
        let hinstance = unsafe { GetModuleHandleW(std::ptr::null()) };

        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(Self::window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: 0 as HICON,
            hCursor: 0 as HCURSOR,
            hbrBackground: 0 as HBRUSH,
            lpszMenuName: 0 as LPCWSTR,
            lpszClassName: winapi_class_name.as_ptr(),
        };

        let error_code = unsafe { RegisterClassW(&wc) };
        assert_ne!(error_code, 0, "failed to register the window class");

        let window_name: Vec<u16> = OsStr::new("OyasumiVRPnPDetectWindow")
            .encode_wide()
            .chain(once(0))
            .collect();

        let hwnd = unsafe {
            CreateWindowExW(
                0,
                winapi_class_name.as_ptr(),
                window_name.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                hinstance,
                self as *mut _ as *mut _,
            )
        };

        if hwnd.is_null() {
            panic!("Something went wrong while creating a window");
        }
        self.hwnd = hwnd;
    }
}

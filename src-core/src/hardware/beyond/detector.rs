use hidapi::HidApi;
use log::error;
use std::ffi::OsStr;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
    PostQuitMessage, RegisterClassW, SetWindowLongPtrW, TranslateMessage, GWLP_USERDATA, MSG,
    WNDCLASSW, WM_CREATE, WM_DESTROY, WM_DEVICECHANGE,
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
                hwnd: HWND::default(),
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
                if val.0 == 0 {
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
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_CREATE => {
                use windows::Win32::UI::WindowsAndMessaging::CREATESTRUCTW;
                let create_struct = lparam.0 as *mut CREATESTRUCTW;
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
        LRESULT(0)
    }

    /// Create an invisible window to handle WM_DEVICECHANGE message
    fn create_window(&mut self) {
        let class_name: Vec<u16> = OsStr::new("OyasumiVRPnPDetectWindowClass")
            .encode_wide()
            .chain(once(0))
            .collect();
        
        let hinstance = unsafe { GetModuleHandleW(None) }.unwrap_or_default();

        let wc = WNDCLASSW {
            style: Default::default(),
            lpfnWndProc: Some(Self::window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance.into(),
            hIcon: Default::default(),
            hCursor: Default::default(),
            hbrBackground: Default::default(),
            lpszMenuName: windows::core::PCWSTR::null(),
            lpszClassName: windows::core::PCWSTR(class_name.as_ptr()),
        };

        let error_code = unsafe { RegisterClassW(&wc) };
        assert_ne!(error_code, 0, "failed to register the window class");

        let window_name: Vec<u16> = OsStr::new("OyasumiVRPnPDetectWindow")
            .encode_wide()
            .chain(once(0))
            .collect();

        let hwnd = unsafe {
            CreateWindowExW(
                Default::default(),
                windows::core::PCWSTR(class_name.as_ptr()),
                windows::core::PCWSTR(window_name.as_ptr()),
                Default::default(),
                0,
                0,
                0,
                0,
                None,
                None,
                hinstance,
                Some(self as *mut _ as *mut _),
            )
        };

        if hwnd == HWND::default() {
            panic!("Something went wrong while creating a window");
        }
        self.hwnd = hwnd;
    }
}

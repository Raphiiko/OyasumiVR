use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use windows::{
    core::{factory, w, Interface, BOOL},
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{
            Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
            GraphicsCaptureSession,
        },
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::{
            Direct3D11::{ID3D11Device, ID3D11Texture2D},
            Dwm::{
                DwmFlush, DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_CLOAKED,
            },
            Dxgi::IDXGIDevice,
            Gdi::{
                ClientToScreen, GetMonitorInfoW, MonitorFromWindow, ScreenToClient, MONITORINFO,
                MONITOR_DEFAULTTONEAREST,
            },
        },
        System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
        },
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{ITaskbarList, TaskbarList},
            WindowsAndMessaging::*,
        },
    },
};

const POOL_BUFFERS: i32 = 2;
/// Windows 10 sometimes rejects a newly shown host, then accepts it a few frames later.
const CREATE_ATTEMPTS: u32 = 10;

pub struct GpuFrame {
    pub texture: ID3D11Texture2D,
    _frame: Direct3D11CaptureFrame,
}

impl Drop for GpuFrame {
    fn drop(&mut self) {
        let _ = self._frame.Close();
    }
}

pub struct DashboardCapture {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    _item: GraphicsCaptureItem,
    /// Set by the item's Closed event, which Windows raises when the host stops being capturable.
    closed: Arc<AtomicBool>,
    host: CaptureHost,
    /// The host, item and frame pool in use, for the log.
    pub summary: String,
}

impl DashboardCapture {
    pub unsafe fn new(
        child: HWND,
        device: &ID3D11Device,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let (host, item) = create_item(child, width, height)?;
        let (pool, session, size) = match start_session(&item, device) {
            Ok(started) => started,
            Err(error) => return Err(format!("{error} [{}]", host.diagnostics())),
        };
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        let handler = TypedEventHandler::new(move |_, _| {
            flag.store(true, Ordering::Release);
            log::warn!("[Dashboard] Windows closed the GPU capture item");
            Ok(())
        });
        if let Err(error) = item.Closed(&handler) {
            log::warn!("[Dashboard] Could not watch the GPU capture item: {error}");
        }
        let summary = format!(
            "{}, item {}x{} on try {}, pool {POOL_BUFFERS} x {}x{}, taskbar tab {}",
            host.label,
            size.Width,
            size.Height,
            host.attempts,
            size.Width,
            size.Height,
            host.taskbar
        );
        Ok(Self {
            session,
            pool,
            _item: item,
            closed,
            host,
            summary,
        })
    }

    /// The host window and WebView state, for a failure log.
    pub fn diagnostics(&self) -> String {
        unsafe { self.host.diagnostics() }
    }

    pub fn next_frame(&self) -> Result<Option<GpuFrame>, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("GraphicsCaptureItem closed".into());
        }
        self.take_frame()
    }

    fn take_frame(&self) -> Result<Option<GpuFrame>, String> {
        let mut latest: Option<Direct3D11CaptureFrame> = None;
        for _ in 0..2 {
            let frame = match self.pool.TryGetNextFrame() {
                Ok(frame) => frame,
                // The WinRT bindings represent a null frame with a successful HRESULT.
                Err(error) if error.code().is_ok() => break,
                Err(error) => return Err(at("TryGetNextFrame")(error)),
            };
            if let Some(previous) = latest.replace(frame) {
                previous
                    .Close()
                    .map_err(at("Direct3D11CaptureFrame.Close"))?;
            }
        }
        latest
            .map(|frame| {
                let access: IDirect3DDxgiInterfaceAccess = frame
                    .Surface()
                    .map_err(at("Direct3D11CaptureFrame.Surface"))?
                    .cast()
                    .map_err(at("IDirect3DDxgiInterfaceAccess"))?;
                let texture = unsafe { access.GetInterface().map_err(at("GetInterface"))? };
                Ok(GpuFrame {
                    texture,
                    _frame: frame,
                })
            })
            .transpose()
    }
}

impl Drop for DashboardCapture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

struct CaptureHost {
    window: HWND,
    child: HWND,
    parent: HWND,
    bounds: RECT,
    label: &'static str,
    /// Outcome of removing the host from the taskbar, for the log.
    taskbar: String,
    /// CreateForWindow calls the item took, for the log.
    attempts: u32,
}

impl CaptureHost {
    unsafe fn new(child: HWND, width: u32, height: u32, cloaked: bool) -> Result<Self, String> {
        let parent = GetParent(child).map_err(at("GetParent"))?;
        let mut bounds = RECT::default();
        GetClientRect(child, &mut bounds).map_err(at("GetClientRect"))?;
        let mut origin = POINT::default();
        ClientToScreen(child, &mut origin)
            .ok()
            .map_err(at("ClientToScreen"))?;
        ScreenToClient(parent, &mut origin)
            .ok()
            .map_err(at("ScreenToClient"))?;
        bounds.left = origin.x;
        bounds.top = origin.y;
        bounds.right += origin.x;
        bounds.bottom += origin.y;
        let window = if cloaked {
            cloaked_window(width, height)?
        } else {
            off_screen_window(width, height).map_err(at("CreateWindowExW"))?
        };
        let host = Self {
            window,
            child,
            parent,
            bounds,
            label: host_label(cloaked),
            taskbar: "untouched".into(),
            attempts: 0,
        };
        SetParent(child, Some(window)).map_err(at("SetParent"))?;
        SetWindowPos(
            child,
            None,
            0,
            0,
            width as i32,
            height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(at("SetWindowPos"))?;
        let _ = ShowWindow(window, SW_SHOWNOACTIVATE);
        Ok(host)
    }

    /// Takes the host out of Alt+Tab and the taskbar while it stays a capturable window.
    ///
    /// Windows 10 closes the capture item of a window that is hidden or becomes a tool window.
    unsafe fn remove_from_taskbar(&mut self) {
        let result = CoCreateInstance::<_, ITaskbarList>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
            .and_then(|taskbar| {
                taskbar.HrInit()?;
                taskbar.DeleteTab(self.window)
            });
        self.taskbar = match result {
            Ok(()) => "removed".into(),
            Err(error) => format!("DeleteTab failed: {error}"),
        };
    }

    unsafe fn diagnostics(&self) -> String {
        format!(
            "host {}; webview {}; taskbar tab {}",
            window_info(self.window),
            window_info(self.child),
            self.taskbar
        )
    }
}

impl Drop for CaptureHost {
    fn drop(&mut self) {
        unsafe {
            if let Err(error) = SetParent(self.child, Some(self.parent)) {
                log::error!("[Dashboard] Could not return WebView to desktop: {error}");
                return;
            }
            let _ = SetWindowPos(
                self.child,
                None,
                self.bounds.left,
                self.bounds.top,
                self.bounds.right - self.bounds.left,
                self.bounds.bottom - self.bounds.top,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
            let _ = DestroyWindow(self.window);
        }
    }
}

/// Creates the capture host and its capture item, trying each host setup until Windows accepts one.
unsafe fn create_item(
    child: HWND,
    width: u32,
    height: u32,
) -> Result<(CaptureHost, GraphicsCaptureItem), String> {
    let mut failures = Vec::new();
    // Windows 10 rejects the tool window host, and some of its builds abort the process instead
    let hosts: &[bool] = if windows_version::OsVersion::current().build < 22000 {
        &[true]
    } else {
        &[false, true]
    };
    for &cloaked in hosts {
        let label = host_label(cloaked);
        let mut host = match CaptureHost::new(child, width, height, cloaked) {
            Ok(host) => host,
            Err(error) => {
                failures.push(format!("{label}: {error}"));
                continue;
            }
        };
        let item = match create_with_retries(&mut host, cloaked) {
            Ok(item) => item,
            Err(error) => {
                failures.push(format!(
                    "{label}: CreateForWindow after {} tries: {error} [{}, capture supported: {:?}]",
                    host.attempts,
                    host.diagnostics(),
                    GraphicsCaptureSession::IsSupported()
                ));
                continue;
            }
        };
        // Windows 10 gives a window it cannot capture a 0x0 item instead of an error
        match item.Size() {
            Ok(size) if size.Width > 0 && size.Height > 0 => {}
            size => {
                failures.push(format!(
                    "{label}: item size {size:?} [{}]",
                    host.diagnostics()
                ));
                continue;
            }
        }
        if cloaked {
            host.remove_from_taskbar();
        }
        return Ok((host, item));
    }
    Err(failures.join("; "))
}

/// Retries the cloaked host once per DWM frame, up to CREATE_ATTEMPTS tries.
unsafe fn create_with_retries(
    host: &mut CaptureHost,
    cloaked: bool,
) -> windows::core::Result<GraphicsCaptureItem> {
    let attempts = if cloaked { CREATE_ATTEMPTS } else { 1 };
    loop {
        host.attempts += 1;
        match create_for_window(host.window) {
            Err(_) if host.attempts < attempts => {
                let _ = DwmFlush();
            }
            result => return result,
        }
    }
}

unsafe fn create_for_window(window: HWND) -> windows::core::Result<GraphicsCaptureItem> {
    factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?.CreateForWindow(window)
}

unsafe fn off_screen_window(width: u32, height: u32) -> windows::core::Result<HWND> {
    CreateWindowExW(
        WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        w!("STATIC"),
        w!("OyasumiVR dashboard capture"),
        WS_POPUP,
        GetSystemMetrics(SM_XVIRTUALSCREEN) - width as i32 - 64,
        GetSystemMetrics(SM_YVIRTUALSCREEN),
        width as i32,
        height as i32,
        None,
        None,
        None,
        None,
    )
}

/// A popup on the primary monitor that DWM never draws.
///
/// Windows 10 creates capture items only for windows that Alt+Tab would list, and gives a window
/// with no part on a monitor a 0x0 item.
unsafe fn cloaked_window(width: u32, height: u32) -> Result<HWND, String> {
    let window = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        w!("STATIC"),
        w!("OyasumiVR dashboard capture"),
        WS_POPUP,
        0,
        0,
        width as i32,
        height as i32,
        None,
        None,
        None,
        None,
    )
    .map_err(at("CreateWindowExW"))?;
    let cloak = BOOL::from(true);
    if let Err(error) = DwmSetWindowAttribute(
        window,
        DWMWA_CLOAK,
        &cloak as *const BOOL as _,
        size_of::<BOOL>() as u32,
    ) {
        let _ = DestroyWindow(window);
        return Err(at("DwmSetWindowAttribute")(error));
    }
    Ok(window)
}

unsafe fn start_session(
    item: &GraphicsCaptureItem,
    device: &ID3D11Device,
) -> Result<
    (
        Direct3D11CaptureFramePool,
        GraphicsCaptureSession,
        SizeInt32,
    ),
    String,
> {
    let size = item.Size().map_err(at("GraphicsCaptureItem.Size"))?;
    let dxgi: IDXGIDevice = device.cast().map_err(at("IDXGIDevice"))?;
    let capture_device: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
        .map_err(at("CreateDirect3D11DeviceFromDXGIDevice"))?
        .cast()
        .map_err(at("IDirect3DDevice"))?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &capture_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        POOL_BUFFERS,
        size,
    )
    .map_err(at("CreateFreeThreaded"))?;
    let session = pool
        .CreateCaptureSession(item)
        .map_err(at("CreateCaptureSession"))?;
    session
        .SetIsCursorCaptureEnabled(false)
        .map_err(at("SetIsCursorCaptureEnabled"))?;
    session.StartCapture().map_err(at("StartCapture"))?;
    Ok((pool, session, size))
}

fn host_label(cloaked: bool) -> &'static str {
    if cloaked {
        "cloaked host"
    } else {
        "tool window host"
    }
}

/// Visibility, cloak, styles, relatives, placement and DPI of a window, for the log.
unsafe fn window_info(window: HWND) -> String {
    let mut cloaked = 0u32;
    let cloaked = DwmGetWindowAttribute(
        window,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as _,
        size_of::<u32>() as u32,
    )
    .map(|_| cloaked.to_string())
    .unwrap_or_else(|error| error.to_string());
    let mut rect = RECT::default();
    let _ = GetWindowRect(window, &mut rect);
    let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let monitor_rect = if GetMonitorInfoW(monitor, &mut info).as_bool() {
        format_rect(info.rcMonitor)
    } else {
        "unknown".into()
    };
    format!(
        "{window:?} visible {}, cloaked {cloaked}, style {:#x}, ex style {:#x}, owner {:?}, \
         parent {:?}, rect {}, monitor {monitor:?} {monitor_rect}, {} DPI",
        IsWindowVisible(window).as_bool(),
        GetWindowLongPtrW(window, GWL_STYLE),
        GetWindowLongPtrW(window, GWL_EXSTYLE),
        GetWindow(window, GW_OWNER).unwrap_or_default(),
        GetAncestor(window, GA_PARENT),
        format_rect(rect),
        GetDpiForWindow(window)
    )
}

fn format_rect(rect: RECT) -> String {
    format!(
        "{}x{} at ({}, {})",
        rect.right - rect.left,
        rect.bottom - rect.top,
        rect.left,
        rect.top
    )
}

/// Prefixes a Windows error with the capture step that returned it.
fn at(step: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |error| format!("{step}: {error}")
}

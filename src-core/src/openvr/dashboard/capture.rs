use windows::{
    core::{factory, w, Interface, BOOL},
    Graphics::{
        Capture::{
            Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
            GraphicsCaptureSession,
        },
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::{
            Direct3D11::{ID3D11Device, ID3D11Texture2D},
            Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK},
            Dxgi::IDXGIDevice,
            Gdi::{ClientToScreen, ScreenToClient},
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
    _host: CaptureHost,
}

impl DashboardCapture {
    pub unsafe fn new(
        child: HWND,
        device: &ID3D11Device,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        let (host, item) = create_item(child, width, height)?;
        let size = item.Size().map_err(at("GraphicsCaptureItem.Size"))?;
        log::info!(
            "[Dashboard] GPU capture item {}x{}",
            size.Width,
            size.Height
        );
        let dxgi: IDXGIDevice = device.cast().map_err(at("IDXGIDevice"))?;
        let capture_device: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
            .map_err(at("CreateDirect3D11DeviceFromDXGIDevice"))?
            .cast()
            .map_err(at("IDirect3DDevice"))?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &capture_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(at("CreateFreeThreaded"))?;
        let session = pool
            .CreateCaptureSession(&item)
            .map_err(at("CreateCaptureSession"))?;
        session
            .SetIsCursorCaptureEnabled(false)
            .map_err(at("SetIsCursorCaptureEnabled"))?;
        session.StartCapture().map_err(at("StartCapture"))?;
        Ok(Self {
            session,
            pool,
            _host: host,
        })
    }

    pub fn next_frame(&self) -> Result<Option<GpuFrame>, String> {
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
    unsafe fn remove_from_taskbar(&self) -> windows::core::Result<()> {
        let taskbar: ITaskbarList = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)?;
        taskbar.HrInit()?;
        taskbar.DeleteTab(self.window)
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
    for cloaked in [false, true] {
        let label = if cloaked {
            "cloaked host"
        } else {
            "tool window host"
        };
        let host = match CaptureHost::new(child, width, height, cloaked) {
            Ok(host) => host,
            Err(error) => {
                failures.push(format!("{label}: {error}"));
                continue;
            }
        };
        let mut rect = RECT::default();
        let _ = GetWindowRect(host.window, &mut rect);
        let host_info = format!(
            "host window {}x{} at ({}, {}), {} DPI, capture supported: {:?}",
            rect.right - rect.left,
            rect.bottom - rect.top,
            rect.left,
            rect.top,
            GetDpiForWindow(host.window),
            GraphicsCaptureSession::IsSupported()
        );
        let item = match create_for_window(host.window) {
            Ok(item) => item,
            Err(error) => {
                failures.push(format!("{label}: CreateForWindow: {error} ({host_info})"));
                continue;
            }
        };
        // Windows 10 gives a window it cannot capture a 0x0 item instead of an error
        match item.Size() {
            Ok(size) if size.Width > 0 && size.Height > 0 => {}
            size => {
                failures.push(format!("{label}: item size {size:?} ({host_info})"));
                continue;
            }
        }
        if cloaked {
            if let Err(error) = host.remove_from_taskbar() {
                log::warn!(
                    "[Dashboard] Could not remove the capture host from the taskbar: {error}"
                );
            }
        }
        log::info!("[Dashboard] GPU capture uses the {label}, {host_info}");
        return Ok((host, item));
    }
    Err(failures.join("; "))
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

/// Prefixes a Windows error with the capture step that returned it.
fn at(step: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |error| format!("{step}: {error}")
}

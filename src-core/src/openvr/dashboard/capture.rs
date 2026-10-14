use windows::{
    core::{factory, w, Interface},
    Graphics::{
        Capture::{
            Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
            GraphicsCaptureSession,
        },
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::{E_FAIL, HWND, POINT, RECT},
        Graphics::{
            Direct3D11::{ID3D11Device, ID3D11Texture2D},
            Dxgi::IDXGIDevice,
            Gdi::{ClientToScreen, ScreenToClient},
        },
        System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
        },
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
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
    /// A plain host is owned by the app window instead of being a tool window.
    unsafe fn new(child: HWND, width: u32, height: u32, plain: bool) -> Result<Self, String> {
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
        let window = if plain {
            let owner = GetAncestor(parent, GA_ROOT);
            off_screen_window(WS_EX_NOACTIVATE, width, height, Some(owner))
        } else {
            off_screen_window(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, width, height, None)
        }
        .map_err(at("CreateWindowExW"))?;
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
    for (plain, mta) in [(false, false), (false, true), (true, false), (true, true)] {
        let label = format!(
            "{} host on the {} thread",
            if plain { "plain" } else { "tool window" },
            if mta { "MTA" } else { "main" }
        );
        let host = CaptureHost::new(child, width, height, plain)?;
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
        match item_for_window(host.window, mta) {
            Ok(item) => {
                log::info!("[Dashboard] GPU capture uses the {label}, {host_info}");
                return Ok((host, item));
            }
            Err(error) => failures.push(format!("{label}: {error} ({host_info})")),
        }
    }
    log_capture_probes(width, height);
    Err(format!("CreateForWindow: {}", failures.join("; ")))
}

unsafe fn item_for_window(window: HWND, mta: bool) -> windows::core::Result<GraphicsCaptureItem> {
    if !mta {
        return create_for_window(window);
    }
    let raw = window.0 as isize;
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        create_for_window(HWND(raw as _))
    })
    .join()
    .unwrap_or_else(|_| Err(E_FAIL.into()))
}

unsafe fn create_for_window(window: HWND) -> windows::core::Result<GraphicsCaptureItem> {
    factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?.CreateForWindow(window)
}

unsafe fn off_screen_window(
    ex_style: WINDOW_EX_STYLE,
    width: u32,
    height: u32,
    owner: Option<HWND>,
) -> windows::core::Result<HWND> {
    CreateWindowExW(
        ex_style,
        w!("STATIC"),
        w!("OyasumiVR dashboard capture"),
        WS_POPUP,
        GetSystemMetrics(SM_XVIRTUALSCREEN) - width as i32 - 64,
        GetSystemMetrics(SM_YVIRTUALSCREEN),
        width as i32,
        height as i32,
        owner,
        None,
        None,
        None,
    )
}

/// Logs which windows this system lets us capture, from this process and from a child process.
unsafe fn log_capture_probes(width: u32, height: u32) {
    let mut results = Vec::new();

    // windows of this process in other setups
    let on_screen = [
        ("empty on-screen popup", WS_EX_NOACTIVATE, WS_POPUP),
        (
            "empty on-screen app window",
            WINDOW_EX_STYLE(0),
            WS_OVERLAPPEDWINDOW,
        ),
    ];
    for (label, ex_style, style) in on_screen {
        let window = CreateWindowExW(
            ex_style,
            w!("STATIC"),
            w!("OyasumiVR capture probe"),
            style,
            0,
            0,
            width as i32,
            height as i32,
            None,
            None,
            None,
            None,
        );
        let Ok(window) = window else {
            results.push(format!("{label}: could not create"));
            continue;
        };
        let _ = ShowWindow(window, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            window,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        );
        results.push(format!(
            "{label}: {}",
            probe_result(create_for_window(window))
        ));
        let _ = DestroyWindow(window);
    }
    if let Ok(window) = FindWindowW(w!("Shell_TrayWnd"), None) {
        results.push(format!(
            "taskbar: {}",
            probe_result(create_for_window(window))
        ));
    }

    // a child process capturing a window of this process, and a window of another process
    if let Ok(host) = off_screen_window(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, width, height, None) {
        let _ = ShowWindow(host, SW_SHOWNOACTIVATE);
        results.push(format!("child process: {}", probe_from_child_process(host)));
        let _ = DestroyWindow(host);
    }

    log::warn!("[Dashboard] GPU capture probes: {}", results.join("; "));
}

fn probe_result(result: windows::core::Result<GraphicsCaptureItem>) -> String {
    match result.and_then(|item| item.Size()) {
        Ok(size) => format!("ok {}x{}", size.Width, size.Height),
        Err(error) => error.to_string(),
    }
}

fn probe_from_child_process(window: HWND) -> String {
    use std::os::windows::process::CommandExt;
    let Ok(exe) = std::env::current_exe() else {
        return "no executable path".into();
    };
    let mut command = std::process::Command::new(exe);
    command
        .arg(PROBE_ARG)
        .arg((window.0 as isize).to_string())
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(command.output());
    });
    match receiver.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(Ok(output)) if output.stdout.is_empty() => format!("no output, {}", output.status),
        Ok(Ok(output)) => String::from_utf8_lossy(&output.stdout)
            .trim()
            .replace('\n', ", "),
        Ok(Err(error)) => format!("could not start: {error}"),
        Err(_) => "timed out".into(),
    }
}

const PROBE_ARG: &str = "--probe-window-capture";

/// Handles `--probe-window-capture <hwnd>` in the child process; returns false on a normal start.
pub fn run_capture_probe_cli() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(PROBE_ARG) {
        return false;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let mut lines = Vec::new();
        if let Some(window) = args.next().and_then(|arg| arg.parse::<isize>().ok()) {
            let result = probe_result(create_for_window(HWND(window as _)));
            lines.push(format!("parent's window: {result}"));
        }
        if let Ok(window) = FindWindowW(w!("Shell_TrayWnd"), None) {
            lines.push(format!(
                "taskbar: {}",
                probe_result(create_for_window(window))
            ));
        }
        println!("{}", lines.join("\n"));
    }
    true
}

/// Prefixes a Windows error with the capture step that returned it.
fn at(step: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |error| format!("{step}: {error}")
}

use windows::{
    core::{factory, w, Interface, Result},
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
            Dxgi::IDXGIDevice,
            Gdi::{ClientToScreen, ScreenToClient},
        },
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
        },
        UI::WindowsAndMessaging::*,
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
    ) -> std::result::Result<Self, String> {
        let host = CaptureHost::new(child, width, height)?;
        let interop: IGraphicsCaptureItemInterop =
            factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                .map_err(at("IGraphicsCaptureItemInterop"))?;
        let item: GraphicsCaptureItem = interop
            .CreateForWindow(host.window)
            .map_err(at("CreateForWindow"))?;
        let size = item.Size().map_err(at("GraphicsCaptureItem.Size"))?;
        let mut rect = RECT::default();
        let _ = GetWindowRect(host.window, &mut rect);
        log::info!(
            "[Dashboard] GPU capture item {}x{}, host window {}x{} at ({}, {})",
            size.Width,
            size.Height,
            rect.right - rect.left,
            rect.bottom - rect.top,
            rect.left,
            rect.top
        );
        let dxgi: IDXGIDevice = device.cast().map_err(at("IDXGIDevice"))?;
        let capture_device: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
            .and_then(|device| device.cast())
            .map_err(at("CreateDirect3D11DeviceFromDXGIDevice"))?;
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

    pub fn next_frame(&self) -> Result<Option<GpuFrame>> {
        let mut latest: Option<Direct3D11CaptureFrame> = None;
        for _ in 0..2 {
            let frame = match self.pool.TryGetNextFrame() {
                Ok(frame) => frame,
                // The WinRT bindings represent a null frame with a successful HRESULT.
                Err(error) if error.code().is_ok() => break,
                Err(error) => return Err(error),
            };
            if let Some(previous) = latest.replace(frame) {
                previous.Close()?;
            }
        }
        latest
            .map(|frame| {
                let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                let texture = unsafe { access.GetInterface()? };
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
    unsafe fn new(child: HWND, width: u32, height: u32) -> std::result::Result<Self, String> {
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
        let window = CreateWindowExW(
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

/// Prefixes a Windows error with the capture step that returned it.
fn at(step: &'static str) -> impl Fn(windows::core::Error) -> String {
    move |error| format!("{step}: {error}")
}

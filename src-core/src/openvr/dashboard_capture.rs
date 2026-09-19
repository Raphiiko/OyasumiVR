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
    pub unsafe fn new(child: HWND, device: &ID3D11Device, width: u32, height: u32) -> Result<Self> {
        let host = CaptureHost::new(child, width, height)?;
        let interop: IGraphicsCaptureItemInterop =
            factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = interop.CreateForWindow(host.window)?;
        let dxgi: IDXGIDevice = device.cast()?;
        let capture_device: IDirect3DDevice =
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &capture_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            item.Size()?,
        )?;
        let session = pool.CreateCaptureSession(&item)?;
        session.SetIsCursorCaptureEnabled(false)?;
        session.StartCapture()?;
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
    unsafe fn new(child: HWND, width: u32, height: u32) -> Result<Self> {
        let parent = GetParent(child)?;
        let mut bounds = RECT::default();
        GetClientRect(child, &mut bounds)?;
        let mut origin = POINT::default();
        ClientToScreen(child, &mut origin).ok()?;
        ScreenToClient(parent, &mut origin).ok()?;
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
        )?;
        let host = Self {
            window,
            child,
            parent,
            bounds,
        };
        SetParent(child, Some(window))?;
        SetWindowPos(
            child,
            None,
            0,
            0,
            width as i32,
            height as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )?;
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

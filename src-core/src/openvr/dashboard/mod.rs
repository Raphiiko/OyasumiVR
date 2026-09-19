mod capture;
mod input;
mod texture;

use self::{
    capture::{DashboardCapture, GpuFrame},
    input::{DashboardInput, KeyboardRequests, PointerEvent},
    texture::DashboardTexture,
};
use super::DASHBOARD_GPU_ACCELERATION;
use crate::globals::TAURI_APP_HANDLE;
use raphii_openvr_rs::{raw, Context};
use std::{
    cell::{Cell, RefCell},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewWindow};
use webview2_com::{CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::*};
use windows::{
    core::{s, w, Interface, BOOL},
    Win32::{
        Foundation::{HWND, RECT},
        Graphics::Direct3D11::ID3D11Device,
        System::{
            Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET},
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
        },
        UI::Shell::SHCreateMemStream,
    },
};

const WIDTH: u32 = 1600;
const HEIGHT: u32 = 900;
const UI_ZOOM: f64 = 1.25;
const INPUT_WIDTH: u32 = (WIDTH as f64 / UI_ZOOM) as u32;
const INPUT_HEIGHT: u32 = (HEIGHT as f64 / UI_ZOOM) as u32;
const PANEL_HEIGHT_METERS: f32 = 1.5;
const FRAME_INTERVAL: Duration = Duration::from_millis(100);
enum CapturedFrame {
    Cpu(Vec<u8>),
    Gpu(GpuFrame),
}
type Frame = Result<CapturedFrame, String>;

thread_local! {
    static DESKTOP: RefCell<Option<Desktop>> = const { RefCell::new(None) };
    static DESKTOP_GENERATION: Cell<u64> = const { Cell::new(0) };
}

struct Desktop {
    window: WebviewWindow,
    controller: ICoreWebView2Controller3,
    bounds: RECT,
    visible: bool,
    webview_visible: BOOL,
    scale: f64,
    detect_scale: BOOL,
    zoom: f64,
    gpu: Option<DashboardCapture>,
    input: Option<DashboardInput>,
}

impl Desktop {
    unsafe fn enter(
        window: WebviewWindow,
        controller: ICoreWebView2Controller,
        device: Option<&ID3D11Device>,
        keyboard: KeyboardRequests,
    ) -> Result<Self, String> {
        let controller: ICoreWebView2Controller3 = controller.cast().map_err(message)?;
        let mut desktop = Self {
            visible: window.is_visible().map_err(message)?,
            window,
            controller,
            bounds: RECT::default(),
            webview_visible: BOOL(0),
            scale: 1.0,
            detect_scale: BOOL(0),
            zoom: 1.0,
            gpu: None,
            input: None,
        };
        desktop
            .controller
            .Bounds(&mut desktop.bounds)
            .map_err(message)?;
        desktop
            .controller
            .IsVisible(&mut desktop.webview_visible)
            .map_err(message)?;
        desktop
            .controller
            .RasterizationScale(&mut desktop.scale)
            .map_err(message)?;
        desktop
            .controller
            .ShouldDetectMonitorScaleChanges(&mut desktop.detect_scale)
            .map_err(message)?;
        desktop
            .controller
            .ZoomFactor(&mut desktop.zoom)
            .map_err(message)?;
        let result = (|| {
            desktop.window.hide().map_err(message)?;
            desktop
                .controller
                .SetShouldDetectMonitorScaleChanges(false)
                .map_err(message)?;
            desktop
                .controller
                .SetRasterizationScale(1.0)
                .map_err(message)?;
            desktop.controller.SetZoomFactor(UI_ZOOM).map_err(message)?;
            desktop
                .controller
                .SetBounds(RECT {
                    left: 0,
                    top: 0,
                    right: WIDTH as i32,
                    bottom: HEIGHT as i32,
                })
                .map_err(message)?;
            desktop.controller.SetIsVisible(true).map_err(message)?;
            if let Some(device) = device {
                let mut child = HWND::default();
                desktop
                    .controller
                    .ParentWindow(&mut child)
                    .map_err(message)?;
                desktop.gpu =
                    Some(DashboardCapture::new(child, device, WIDTH, HEIGHT).map_err(message)?);
            }
            desktop.input = Some(DashboardInput::new(
                desktop.controller.CoreWebView2().map_err(message)?,
                INPUT_WIDTH,
                INPUT_HEIGHT,
            ));
            desktop
                .input
                .as_ref()
                .unwrap()
                .set_keyboard_requests(keyboard);
            Ok(())
        })();
        if let Err(error) = result {
            desktop.restore();
            return Err(error);
        }
        Ok(desktop)
    }

    fn restore(mut self) {
        if let Some(input) = self.input.as_mut() {
            input.finish();
        }
        self.gpu.take();
        unsafe {
            for result in [
                self.controller.SetBounds(self.bounds),
                self.controller.SetZoomFactor(self.zoom),
                self.controller.SetRasterizationScale(self.scale),
                self.controller
                    .SetShouldDetectMonitorScaleChanges(self.detect_scale.as_bool()),
                self.controller.SetIsVisible(self.webview_visible.as_bool()),
            ] {
                if let Err(error) = result {
                    log::error!("[Dashboard] Could not restore WebView: {error}");
                }
            }
        }
        if self.visible {
            if let Err(error) = self.window.show() {
                log::error!("[Dashboard] Could not restore desktop window: {error}");
            }
        }
    }
}

pub struct DashboardOverlay {
    table: raw::VR_IVROverlay_FnTable,
    main: u64,
    thumbnail: u64,
    window: WebviewWindow,
    active: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    frame: Arc<Mutex<Option<Frame>>>,
    next_frame: Instant,
    capture_started: Instant,
    activation_started: Option<Instant>,
    selected: bool,
    failed: bool,
    has_frame: bool,
    texture: DashboardTexture,
    gpu: bool,
    keyboard: KeyboardRequests,
    keyboard_id: Option<u64>,
}

impl DashboardOverlay {
    pub async fn create(context: &Context) -> Result<Self, String> {
        if !context.overlay_interface_available() {
            return Err("OpenVR overlay interface is unavailable".into());
        }
        let window = TAURI_APP_HANDLE
            .lock()
            .await
            .as_ref()
            .and_then(|app| app.get_webview_window("main"))
            .ok_or("Main window is unavailable")?;
        let table: raw::VR_IVROverlay_FnTable =
            unsafe { interface_table(raw::IVROverlay_Version)? };
        let system: raw::VR_IVRSystem_FnTable = unsafe { interface_table(raw::IVRSystem_Version)? };
        let mut adapter_index = -1;
        unsafe {
            required(system.GetDXGIOutputInfo)?(&mut adapter_index);
        }
        if adapter_index < 0 {
            return Err("SteamVR did not identify a graphics adapter".into());
        }
        let texture =
            unsafe { DashboardTexture::new(adapter_index, WIDTH, HEIGHT).map_err(message)? };
        let mut overlay = Self {
            table,
            main: 0,
            thumbnail: 0,
            window,
            active: Arc::new(AtomicBool::new(false)),
            busy: Arc::new(AtomicBool::new(false)),
            frame: Arc::new(Mutex::new(None)),
            next_frame: Instant::now(),
            capture_started: Instant::now(),
            activation_started: None,
            selected: false,
            failed: false,
            has_frame: false,
            texture,
            gpu: DASHBOARD_GPU_ACCELERATION.load(Ordering::Acquire),
            keyboard: Arc::new(Mutex::new(None)),
            keyboard_id: None,
        };
        required(table.DestroyOverlay)?;
        required(table.IsActiveDashboardOverlay)?;
        required(table.SetOverlayRaw)?;
        required(table.SetOverlayTexture)?;
        required(table.PollNextOverlayEvent)?;
        unsafe {
            check(required(table.CreateDashboardOverlay)?(
                c"co.raphii.oyasumivr:MainDashboard".as_ptr().cast_mut(),
                c"OyasumiVR".as_ptr().cast_mut(),
                &mut overlay.main,
                &mut overlay.thumbnail,
            ))?;
            check(required(table.SetOverlayWidthInMeters)?(
                overlay.main,
                PANEL_HEIGHT_METERS * WIDTH as f32 / HEIGHT as f32,
            ))?;
            check(required(table.SetOverlayMouseScale)?(
                overlay.main,
                &mut raw::HmdVector2_t {
                    v: [INPUT_WIDTH as f32, INPUT_HEIGHT as f32],
                },
            ))?;
            check(required(table.SetOverlayInputMethod)?(
                overlay.main,
                raw::VROverlayInputMethod::Mouse,
            ))?;
            check(required(table.SetOverlayFlag)?(
                overlay.main,
                raw::VROverlayFlags::SendVRSmoothScrollEvents,
                true,
            ))?;
            let icon =
                tauri::image::Image::from_bytes(include_bytes!("../../../icons/128x128.png"))
                    .map_err(message)?;
            overlay.submit(overlay.thumbnail, &icon)?;
            let blank = tauri::image::Image::new_owned(
                [24, 24, 28, 255].repeat((WIDTH * HEIGHT) as usize),
                WIDTH,
                HEIGHT,
            );
            overlay
                .texture
                .upload(blank.rgba(), blank.width())
                .map_err(message)?;
            let mut texture = overlay.overlay_texture();
            check(required(table.SetOverlayTexture)?(
                overlay.main,
                &mut texture,
            ))?;
        }
        log::info!("[Dashboard] Dashboard overlay registered");
        Ok(overlay)
    }

    pub fn is_active(&self) -> bool {
        self.selected && !self.failed
    }

    pub fn tick(&mut self) -> Result<(), String> {
        // track dashboard selection
        let selected = unsafe { required(self.table.IsActiveDashboardOverlay)?(self.main) };
        if selected != self.selected {
            self.selected = selected;
            self.failed = false;
            log::info!("[Dashboard] Dashboard selected: {selected}");
            if !selected {
                self.restore();
            }
        }
        // apply capture settings
        let gpu = DASHBOARD_GPU_ACCELERATION.load(Ordering::Acquire);
        if gpu != self.gpu {
            self.restore();
            self.gpu = gpu;
            self.failed = false;
        }
        // process controller input
        self.poll_input(selected && !self.failed && self.has_frame)?;
        if selected && !self.failed && self.has_frame {
            self.show_keyboard();
        }
        if !selected || self.failed {
            return Ok(());
        }
        // enforce activation and desktop ownership
        if !self.has_frame
            && self
                .activation_started
                .get_or_insert_with(Instant::now)
                .elapsed()
                > Duration::from_secs(5)
        {
            return Err("No dashboard frame arrived within five seconds".into());
        }
        if self.has_frame && self.window.is_visible().map_err(message)? {
            self.failed = true;
            self.restore();
            return Ok(());
        }
        // submit the latest frame
        let frame = self.frame.lock().unwrap().take();
        if let Some(frame) = frame {
            unsafe {
                match frame? {
                    CapturedFrame::Cpu(png) => {
                        let image = tauri::image::Image::from_bytes(&png).map_err(message)?;
                        if image.width() != WIDTH || image.height() != HEIGHT {
                            return Err("Unexpected dashboard frame dimensions".into());
                        }
                        self.texture
                            .upload(image.rgba(), image.width())
                            .map_err(message)?
                    }
                    CapturedFrame::Gpu(frame) => {
                        self.texture.copy(&frame.texture).map_err(message)?
                    }
                };
                let mut texture = self.overlay_texture();
                check(required(self.table.SetOverlayTexture)?(
                    self.main,
                    &mut texture,
                ))?;
            }
            if !self.has_frame {
                log::info!(
                    "[Dashboard] First {WIDTH}x{HEIGHT} frame submitted via {} capture in {:?}",
                    if self.gpu { "GPU" } else { "CPU" },
                    self.activation_started
                        .map(|started| started.elapsed())
                        .unwrap_or_default()
                );
            }
            self.has_frame = true;
        }
        // request the next frame
        if self.busy.load(Ordering::Acquire) {
            if self.capture_started.elapsed() > Duration::from_secs(5) {
                return Err("WebView capture timed out".into());
            }
            return Ok(());
        }
        if Instant::now() < self.next_frame {
            return Ok(());
        }
        self.next_frame = Instant::now()
            + if self.gpu {
                Duration::ZERO
            } else {
                FRAME_INTERVAL
            };
        self.capture_started = Instant::now();
        self.busy.store(true, Ordering::Release);
        self.active.store(true, Ordering::Release);
        let window = self.window.clone();
        let active = self.active.clone();
        let busy = self.busy.clone();
        let frame = self.frame.clone();
        let device = self.gpu.then(|| self.texture.device().clone());
        let keyboard = self.keyboard.clone();
        self.window
            .with_webview(move |webview| {
                if !active.load(Ordering::Acquire) {
                    busy.store(false, Ordering::Release);
                    return;
                }
                let result = unsafe {
                    let controller: ICoreWebView2Controller =
                        std::mem::transmute(webview.controller());
                    DESKTOP.with(|saved| -> Result<(), String> {
                        DESKTOP_GENERATION.with(|generation| generation.set(generation.get() + 1));
                        if saved.borrow().is_none() {
                            *saved.borrow_mut() = Some(Desktop::enter(
                                window,
                                controller.clone(),
                                device.as_ref(),
                                keyboard,
                            )?);
                        }
                        if let Some(gpu) = saved
                            .borrow()
                            .as_ref()
                            .and_then(|desktop| desktop.gpu.as_ref())
                        {
                            if let Some(captured) = gpu.next_frame().map_err(message)? {
                                *frame.lock().unwrap() = Some(Ok(CapturedFrame::Gpu(captured)));
                            }
                            busy.store(false, Ordering::Release);
                            return Ok(());
                        }
                        capture(
                            &controller.CoreWebView2().map_err(message)?,
                            active.clone(),
                            busy.clone(),
                            frame.clone(),
                        )
                    })
                };
                if let Err(error) = result {
                    *frame.lock().unwrap() = Some(Err(error));
                    busy.store(false, Ordering::Release);
                }
            })
            .map_err(message)
    }

    fn poll_input(&mut self, accept: bool) -> Result<(), String> {
        let mut events = Vec::new();
        for _ in 0..256 {
            let mut event = raw::VREvent_t::default();
            if !unsafe {
                required(self.table.PollNextOverlayEvent)?(
                    self.main,
                    &mut event,
                    std::mem::size_of::<raw::VREvent_t>() as u32,
                )
            } {
                break;
            }
            if !accept {
                continue;
            }
            let input = unsafe {
                match event.eventType {
                    n if n == raw::EVREventType::VREvent_MouseMove.0 as u32 => {
                        Some(PointerEvent::Move(event.data.mouse.x, event.data.mouse.y))
                    }
                    n if n == raw::EVREventType::VREvent_MouseButtonDown.0 as u32
                        || n == raw::EVREventType::VREvent_MouseButtonUp.0 as u32 =>
                    {
                        Some(PointerEvent::Button {
                            button: event.data.mouse.button,
                            down: n == raw::EVREventType::VREvent_MouseButtonDown.0 as u32,
                        })
                    }
                    n if n == raw::EVREventType::VREvent_ScrollSmooth.0 as u32 => Some(
                        PointerEvent::Scroll(event.data.scroll.xdelta, event.data.scroll.ydelta),
                    ),
                    n if n == raw::EVREventType::VREvent_FocusLeave.0 as u32 => {
                        Some(PointerEvent::Leave)
                    }
                    n if n == raw::EVREventType::VREvent_KeyboardCharInput.0 as u32 => {
                        let key = event.data.keyboard;
                        if self.keyboard_id == Some(key.uUserValue) {
                            let bytes: Vec<u8> = key
                                .cNewInput
                                .iter()
                                .take_while(|byte| **byte != 0)
                                .map(|byte| *byte as u8)
                                .collect();
                            Some(PointerEvent::KeyboardKey {
                                id: key.uUserValue,
                                text: String::from_utf8_lossy(&bytes).into_owned(),
                            })
                        } else {
                            None
                        }
                    }
                    n if n == raw::EVREventType::VREvent_KeyboardDone.0 as u32
                        || n == raw::EVREventType::VREvent_KeyboardClosed.0 as u32 =>
                    {
                        let id = event.data.keyboard.uUserValue;
                        if self.keyboard_id == Some(id) {
                            self.keyboard_id = None;
                            Some(PointerEvent::KeyboardDone { id })
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            };
            if let Some(input) = input {
                events.push(input);
            }
        }
        if events.is_empty() {
            return Ok(());
        }
        let active = self.active.clone();
        self.window
            .run_on_main_thread(move || {
                if !active.load(Ordering::Acquire) {
                    return;
                }
                DESKTOP.with(|saved| {
                    if let Some(input) = saved
                        .borrow_mut()
                        .as_mut()
                        .and_then(|desktop| desktop.input.as_mut())
                    {
                        for event in events {
                            input.handle(event);
                        }
                    }
                });
            })
            .map_err(message)
    }

    fn show_keyboard(&mut self) {
        let request = self.keyboard.lock().unwrap().take();
        let Some(request) = request else {
            return;
        };
        let result = (|| -> Result<(), String> {
            if self.keyboard_id.take().is_some() {
                unsafe {
                    required(self.table.HideKeyboard)?();
                }
            }
            unsafe {
                check(required(self.table.ShowKeyboardForOverlay)?(
                    self.main,
                    if request.password {
                        raw::EGamepadTextInputMode::k_EGamepadTextInputModePassword
                    } else {
                        raw::EGamepadTextInputMode::k_EGamepadTextInputModeNormal
                    },
                    if request.multiline {
                        raw::EGamepadTextInputLineMode::k_EGamepadTextInputLineModeMultipleLines
                    } else {
                        raw::EGamepadTextInputLineMode::k_EGamepadTextInputLineModeSingleLine
                    },
                    (raw::EKeyboardFlags::KeyboardFlag_Modal.0
                        | raw::EKeyboardFlags::KeyboardFlag_Minimal.0
                        | raw::EKeyboardFlags::KeyboardFlag_ShowArrowKeys.0)
                        as u32,
                    c"OyasumiVR".as_ptr().cast_mut(),
                    request.max_length.clamp(1, 65535),
                    c"".as_ptr().cast_mut(),
                    request.id,
                ))?;
            }
            self.keyboard_id = Some(request.id);
            Ok(())
        })();
        if let Err(error) = result {
            log::warn!("[Dashboard] Could not open keyboard: {error}");
        }
    }

    fn overlay_texture(&self) -> raw::Texture_t {
        raw::Texture_t {
            handle: self.texture.texture().as_raw(),
            eType: raw::ETextureType::TextureType_DirectX,
            eColorSpace: raw::EColorSpace::ColorSpace_Auto,
        }
    }

    unsafe fn submit(&self, handle: u64, image: &tauri::image::Image<'_>) -> Result<(), String> {
        check(required(self.table.SetOverlayRaw)?(
            handle,
            image.rgba().as_ptr().cast_mut().cast(),
            image.width(),
            image.height(),
            4,
        ))
    }

    fn restore(&mut self) {
        if self.keyboard_id.take().is_some() {
            if let Some(hide) = self.table.HideKeyboard {
                unsafe {
                    hide();
                }
            }
        }
        self.keyboard = Arc::new(Mutex::new(None));
        self.active.store(false, Ordering::Release);
        self.has_frame = false;
        self.activation_started = None;
        *self.frame.lock().unwrap() = None;
        // A new activation must not accept callbacks from the previous capture.
        self.active = Arc::new(AtomicBool::new(false));
        self.busy = Arc::new(AtomicBool::new(false));
        self.frame = Arc::new(Mutex::new(None));
        let generation = DESKTOP_GENERATION.with(Cell::get);
        if let Err(error) = self.window.run_on_main_thread(move || {
            if DESKTOP_GENERATION.with(Cell::get) != generation {
                return;
            }
            DESKTOP.with(|saved| {
                if let Some(desktop) = saved.borrow_mut().take() {
                    desktop.restore();
                }
            });
        }) {
            log::error!("[Dashboard] Could not schedule desktop restoration: {error}");
        }
    }
}

impl Drop for DashboardOverlay {
    fn drop(&mut self) {
        self.restore();
        if let Some(destroy) = self.table.DestroyOverlay {
            if self.main != 0 {
                if let Err(error) = check(unsafe { destroy(self.main) }) {
                    log::warn!("[Dashboard] Could not destroy overlay: {error}");
                }
            }
        }
    }
}

unsafe fn capture(
    webview: &ICoreWebView2,
    active: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    frame: Arc<Mutex<Option<Frame>>>,
) -> Result<(), String> {
    let stream = SHCreateMemStream(None).ok_or("Could not allocate capture stream")?;
    let output = stream.clone();
    webview
        .CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            &stream,
            &CapturePreviewCompletedHandler::create(Box::new(move |result| {
                if active.load(Ordering::Acquire) {
                    *frame.lock().unwrap() = Some(
                        result
                            .map_err(message)
                            .and_then(|_| read_stream(&output))
                            .map(CapturedFrame::Cpu),
                    );
                }
                busy.store(false, Ordering::Release);
                Ok(())
            })),
        )
        .map_err(message)
}

unsafe fn read_stream(stream: &IStream) -> Result<Vec<u8>, String> {
    let mut stat = STATSTG::default();
    stream.Stat(&mut stat, STATFLAG_NONAME).map_err(message)?;
    if stat.cbSize == 0 || stat.cbSize > 32 * 1024 * 1024 {
        return Err("Invalid capture size".into());
    }
    let mut bytes = vec![0; stat.cbSize as usize];
    stream.Seek(0, STREAM_SEEK_SET, None).map_err(message)?;
    let mut read = 0;
    stream
        .Read(
            bytes.as_mut_ptr().cast(),
            bytes.len() as u32,
            Some(&mut read),
        )
        .ok()
        .map_err(message)?;
    if read as usize != bytes.len() {
        return Err("Incomplete capture".into());
    }
    Ok(bytes)
}

// The OpenVR task owns this table and drops the overlay before shutting down its context.
unsafe fn interface_table<T: Copy>(version: &[u8]) -> Result<T, String> {
    let module = GetModuleHandleW(w!("openvr_api.dll")).map_err(message)?;
    let address = GetProcAddress(module, s!("VR_GetGenericInterface"))
        .ok_or("Missing VR_GetGenericInterface")?;
    let get: unsafe extern "C" fn(*const i8, *mut i32) -> *mut std::ffi::c_void =
        std::mem::transmute(address);
    let mut name = b"FnTable:".to_vec();
    name.extend_from_slice(version);
    let mut error = 0;
    let table = get(name.as_ptr().cast(), &mut error);
    if error != 0 || table.is_null() {
        return Err(format!("OpenVR overlay interface error {error}"));
    }
    Ok(table.cast::<T>().read())
}

fn required<T>(function: Option<T>) -> Result<T, String> {
    function.ok_or("Missing OpenVR dashboard function".into())
}
fn check(error: raw::EVROverlayError) -> Result<(), String> {
    if error.0 == 0 {
        Ok(())
    } else {
        Err(format!("OpenVR overlay error {}", error.0))
    }
}
fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

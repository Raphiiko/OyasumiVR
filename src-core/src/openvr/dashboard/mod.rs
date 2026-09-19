mod capture;
mod input;
mod texture;

use self::{
    capture::{DashboardCapture, GpuFrame},
    input::{DashboardInput, KeyboardRequest, KeyboardRequests, PointerEvent},
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
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(5);
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_PNG_BYTES: u64 = 32 * 1024 * 1024;

const MOUSE_MOVE: u32 = raw::EVREventType::VREvent_MouseMove.0 as u32;
const MOUSE_BUTTON_DOWN: u32 = raw::EVREventType::VREvent_MouseButtonDown.0 as u32;
const MOUSE_BUTTON_UP: u32 = raw::EVREventType::VREvent_MouseButtonUp.0 as u32;
const SCROLL_SMOOTH: u32 = raw::EVREventType::VREvent_ScrollSmooth.0 as u32;
const FOCUS_LEAVE: u32 = raw::EVREventType::VREvent_FocusLeave.0 as u32;
const KEYBOARD_CHAR_INPUT: u32 = raw::EVREventType::VREvent_KeyboardCharInput.0 as u32;
const KEYBOARD_DONE: u32 = raw::EVREventType::VREvent_KeyboardDone.0 as u32;
const KEYBOARD_CLOSED: u32 = raw::EVREventType::VREvent_KeyboardClosed.0 as u32;

enum CapturedFrame {
    Cpu(Vec<u8>),
    Gpu(GpuFrame),
}
type Frame = Result<CapturedFrame, String>;

/// Shared between the OpenVR task and the capture callbacks of one activation.
#[derive(Default)]
struct CaptureState {
    active: AtomicBool,
    busy: AtomicBool,
    frame: Mutex<Option<Frame>>,
}

thread_local! {
    static DESKTOP: RefCell<Option<Desktop>> = const { RefCell::new(None) };
    static DESKTOP_GENERATION: Cell<u64> = const { Cell::new(0) };
}

/// The desktop WebView state to put back when the dashboard is left.
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
        let mut desktop = Self::save(window, controller)?;
        if let Err(error) = desktop.apply(device, keyboard) {
            desktop.restore();
            return Err(error);
        }
        Ok(desktop)
    }

    unsafe fn save(
        window: WebviewWindow,
        controller: ICoreWebView2Controller,
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
        let controller = &desktop.controller;
        controller.Bounds(&mut desktop.bounds).map_err(message)?;
        controller
            .IsVisible(&mut desktop.webview_visible)
            .map_err(message)?;
        controller
            .RasterizationScale(&mut desktop.scale)
            .map_err(message)?;
        controller
            .ShouldDetectMonitorScaleChanges(&mut desktop.detect_scale)
            .map_err(message)?;
        controller.ZoomFactor(&mut desktop.zoom).map_err(message)?;
        Ok(desktop)
    }

    unsafe fn apply(
        &mut self,
        device: Option<&ID3D11Device>,
        keyboard: KeyboardRequests,
    ) -> Result<(), String> {
        self.window.hide().map_err(message)?;
        self.controller
            .SetShouldDetectMonitorScaleChanges(false)
            .map_err(message)?;
        self.controller
            .SetRasterizationScale(1.0)
            .map_err(message)?;
        self.controller.SetZoomFactor(UI_ZOOM).map_err(message)?;
        self.controller
            .SetBounds(RECT {
                left: 0,
                top: 0,
                right: WIDTH as i32,
                bottom: HEIGHT as i32,
            })
            .map_err(message)?;
        self.controller.SetIsVisible(true).map_err(message)?;
        if let Some(device) = device {
            let mut child = HWND::default();
            self.controller.ParentWindow(&mut child).map_err(message)?;
            self.gpu = Some(DashboardCapture::new(child, device, WIDTH, HEIGHT).map_err(message)?);
        }
        let webview = self.controller.CoreWebView2().map_err(message)?;
        self.input = Some(DashboardInput::new(
            webview,
            INPUT_WIDTH,
            INPUT_HEIGHT,
            keyboard,
        ));
        Ok(())
    }

    fn restore(mut self) {
        if let Some(input) = self.input.as_mut() {
            input.finish();
        }
        self.gpu.take();
        let results = unsafe {
            [
                self.controller.SetBounds(self.bounds),
                self.controller.SetZoomFactor(self.zoom),
                self.controller.SetRasterizationScale(self.scale),
                self.controller
                    .SetShouldDetectMonitorScaleChanges(self.detect_scale.as_bool()),
                self.controller.SetIsVisible(self.webview_visible.as_bool()),
            ]
        };
        for error in results.into_iter().filter_map(Result::err) {
            log::error!("[Dashboard] Could not restore WebView: {error}");
        }
        if self.visible {
            if let Err(error) = self.window.show() {
                log::error!("[Dashboard] Could not restore desktop window: {error}");
            }
        }
    }
}

/// Drop this before the OpenVR context shuts down; the function table belongs to it.
pub struct DashboardOverlay {
    table: raw::VR_IVROverlay_FnTable,
    main: u64,
    thumbnail: u64,
    window: WebviewWindow,
    texture: DashboardTexture,
    capture: Arc<CaptureState>,
    next_frame: Instant,
    capture_started: Instant,
    activation_started: Option<Instant>,
    selected: bool,
    failed: bool,
    has_frame: bool,
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
            texture,
            capture: Arc::default(),
            next_frame: Instant::now(),
            capture_started: Instant::now(),
            activation_started: None,
            selected: false,
            failed: false,
            has_frame: false,
            gpu: DASHBOARD_GPU_ACCELERATION.load(Ordering::Acquire),
            keyboard: Arc::new(Mutex::new(None)),
            keyboard_id: None,
        };
        // fail early on functions that every tick needs
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
            overlay.set_raw_image(overlay.thumbnail, &icon)?;
            let blank = tauri::image::Image::new_owned(
                [24, 24, 28, 255].repeat((WIDTH * HEIGHT) as usize),
                WIDTH,
                HEIGHT,
            );
            overlay
                .texture
                .upload(blank.rgba(), blank.width())
                .map_err(message)?;
            overlay.set_overlay_texture()?;
        }
        log::info!("[Dashboard] Dashboard overlay registered");
        Ok(overlay)
    }

    pub fn is_active(&self) -> bool {
        self.selected && !self.failed
    }

    pub fn tick(&mut self) -> Result<(), String> {
        self.sync_selection()?;
        self.sync_capture_mode();
        let ready = self.is_active() && self.has_frame;
        self.poll_input(ready)?;
        if ready {
            self.open_requested_keyboard();
        }
        if !self.is_active() {
            return Ok(());
        }
        // give up when no frame arrives, or the desktop window came back
        let waiting = self
            .activation_started
            .get_or_insert_with(Instant::now)
            .elapsed();
        if !self.has_frame && waiting > FIRST_FRAME_TIMEOUT {
            return Err("No dashboard frame arrived within five seconds".into());
        }
        if self.has_frame && self.window.is_visible().map_err(message)? {
            self.failed = true;
            self.deactivate();
            return Ok(());
        }
        self.submit_frame()?;
        self.request_frame()
    }

    fn sync_selection(&mut self) -> Result<(), String> {
        let selected = unsafe { required(self.table.IsActiveDashboardOverlay)?(self.main) };
        if selected == self.selected {
            return Ok(());
        }
        self.selected = selected;
        self.failed = false;
        log::info!("[Dashboard] Dashboard selected: {selected}");
        if !selected {
            self.deactivate();
        }
        Ok(())
    }

    fn sync_capture_mode(&mut self) {
        let gpu = DASHBOARD_GPU_ACCELERATION.load(Ordering::Acquire);
        if gpu != self.gpu {
            self.deactivate();
            self.gpu = gpu;
            self.failed = false;
        }
    }

    fn submit_frame(&mut self) -> Result<(), String> {
        let Some(frame) = self.capture.frame.lock().unwrap().take() else {
            return Ok(());
        };
        unsafe {
            match frame? {
                CapturedFrame::Cpu(png) => {
                    let image = tauri::image::Image::from_bytes(&png).map_err(message)?;
                    if image.width() != WIDTH || image.height() != HEIGHT {
                        return Err("Unexpected dashboard frame dimensions".into());
                    }
                    self.texture
                        .upload(image.rgba(), image.width())
                        .map_err(message)?;
                }
                CapturedFrame::Gpu(frame) => {
                    self.texture.copy(&frame.texture).map_err(message)?;
                }
            }
            self.set_overlay_texture()?;
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
        Ok(())
    }

    fn request_frame(&mut self) -> Result<(), String> {
        if self.capture.busy.load(Ordering::Acquire) {
            if self.capture_started.elapsed() > CAPTURE_TIMEOUT {
                return Err("WebView capture timed out".into());
            }
            return Ok(());
        }
        if Instant::now() < self.next_frame {
            return Ok(());
        }
        let interval = if self.gpu {
            Duration::ZERO
        } else {
            FRAME_INTERVAL
        };
        self.next_frame = Instant::now() + interval;
        self.capture_started = Instant::now();
        self.capture.busy.store(true, Ordering::Release);
        self.capture.active.store(true, Ordering::Release);
        let window = self.window.clone();
        let capture = self.capture.clone();
        let device = self.gpu.then(|| self.texture.device().clone());
        let keyboard = self.keyboard.clone();
        self.window
            .with_webview(move |webview| {
                if !capture.active.load(Ordering::Acquire) {
                    capture.busy.store(false, Ordering::Release);
                    return;
                }
                let result = unsafe {
                    let controller: ICoreWebView2Controller =
                        std::mem::transmute(webview.controller());
                    capture_frame(window, controller, device.as_ref(), keyboard, &capture)
                };
                if let Err(error) = result {
                    *capture.frame.lock().unwrap() = Some(Err(error));
                    capture.busy.store(false, Ordering::Release);
                }
            })
            .map_err(message)
    }

    fn poll_input(&mut self, accept: bool) -> Result<(), String> {
        let mut events = Vec::new();
        for _ in 0..256 {
            let mut event = raw::VREvent_t::default();
            let polled = unsafe {
                required(self.table.PollNextOverlayEvent)?(
                    self.main,
                    &mut event,
                    std::mem::size_of::<raw::VREvent_t>() as u32,
                )
            };
            if !polled {
                break;
            }
            if !accept {
                continue;
            }
            if let Some(input) = unsafe { self.translate(&event) } {
                events.push(input);
            }
        }
        if events.is_empty() {
            return Ok(());
        }
        let capture = self.capture.clone();
        self.window
            .run_on_main_thread(move || {
                if !capture.active.load(Ordering::Acquire) {
                    return;
                }
                DESKTOP.with(|saved| {
                    let mut saved = saved.borrow_mut();
                    let Some(input) = saved.as_mut().and_then(|desktop| desktop.input.as_mut())
                    else {
                        return;
                    };
                    for event in events {
                        input.handle(event);
                    }
                });
            })
            .map_err(message)
    }

    unsafe fn translate(&mut self, event: &raw::VREvent_t) -> Option<PointerEvent> {
        match event.eventType {
            MOUSE_MOVE => Some(PointerEvent::Move(event.data.mouse.x, event.data.mouse.y)),
            MOUSE_BUTTON_DOWN | MOUSE_BUTTON_UP => Some(PointerEvent::Button {
                button: event.data.mouse.button,
                down: event.eventType == MOUSE_BUTTON_DOWN,
            }),
            SCROLL_SMOOTH => Some(PointerEvent::Scroll(
                event.data.scroll.xdelta,
                event.data.scroll.ydelta,
            )),
            FOCUS_LEAVE => Some(PointerEvent::Leave),
            KEYBOARD_CHAR_INPUT => {
                let key = event.data.keyboard;
                if self.keyboard_id != Some(key.uUserValue) {
                    return None;
                }
                Some(PointerEvent::KeyboardKey {
                    id: key.uUserValue,
                    text: keyboard_text(&key.cNewInput),
                })
            }
            KEYBOARD_DONE | KEYBOARD_CLOSED => {
                let id = event.data.keyboard.uUserValue;
                if self.keyboard_id != Some(id) {
                    return None;
                }
                self.keyboard_id = None;
                Some(PointerEvent::KeyboardDone { id })
            }
            _ => None,
        }
    }

    fn open_requested_keyboard(&mut self) {
        let request = self.keyboard.lock().unwrap().take();
        let Some(request) = request else {
            return;
        };
        if let Err(error) = self.show_keyboard(&request) {
            log::warn!("[Dashboard] Could not open keyboard: {error}");
        }
    }

    fn show_keyboard(&mut self, request: &KeyboardRequest) -> Result<(), String> {
        self.hide_keyboard()?;
        let input_mode = if request.password {
            raw::EGamepadTextInputMode::k_EGamepadTextInputModePassword
        } else {
            raw::EGamepadTextInputMode::k_EGamepadTextInputModeNormal
        };
        let line_mode = if request.multiline {
            raw::EGamepadTextInputLineMode::k_EGamepadTextInputLineModeMultipleLines
        } else {
            raw::EGamepadTextInputLineMode::k_EGamepadTextInputLineModeSingleLine
        };
        let flags = raw::EKeyboardFlags::KeyboardFlag_Modal.0
            | raw::EKeyboardFlags::KeyboardFlag_Minimal.0
            | raw::EKeyboardFlags::KeyboardFlag_ShowArrowKeys.0;
        unsafe {
            check(required(self.table.ShowKeyboardForOverlay)?(
                self.main,
                input_mode,
                line_mode,
                flags as u32,
                c"OyasumiVR".as_ptr().cast_mut(),
                request.max_length.clamp(1, 65535),
                c"".as_ptr().cast_mut(),
                request.id,
            ))?;
        }
        self.keyboard_id = Some(request.id);
        Ok(())
    }

    fn hide_keyboard(&mut self) -> Result<(), String> {
        if self.keyboard_id.take().is_none() {
            return Ok(());
        }
        unsafe {
            required(self.table.HideKeyboard)?();
        }
        Ok(())
    }

    unsafe fn set_overlay_texture(&self) -> Result<(), String> {
        let mut texture = raw::Texture_t {
            handle: self.texture.texture().as_raw(),
            eType: raw::ETextureType::TextureType_DirectX,
            eColorSpace: raw::EColorSpace::ColorSpace_Auto,
        };
        check(required(self.table.SetOverlayTexture)?(
            self.main,
            &mut texture,
        ))
    }

    unsafe fn set_raw_image(
        &self,
        handle: u64,
        image: &tauri::image::Image<'_>,
    ) -> Result<(), String> {
        check(required(self.table.SetOverlayRaw)?(
            handle,
            image.rgba().as_ptr().cast_mut().cast(),
            image.width(),
            image.height(),
            4,
        ))
    }

    fn deactivate(&mut self) {
        if let Err(error) = self.hide_keyboard() {
            log::warn!("[Dashboard] Could not hide keyboard: {error}");
        }
        self.keyboard = Arc::new(Mutex::new(None));
        self.has_frame = false;
        self.activation_started = None;
        // callbacks of the previous capture must not reach the next activation
        self.capture.active.store(false, Ordering::Release);
        self.capture = Arc::default();
        let generation = DESKTOP_GENERATION.with(Cell::get);
        let scheduled = self.window.run_on_main_thread(move || {
            if DESKTOP_GENERATION.with(Cell::get) != generation {
                return;
            }
            DESKTOP.with(|saved| {
                if let Some(desktop) = saved.borrow_mut().take() {
                    desktop.restore();
                }
            });
        });
        if let Err(error) = scheduled {
            log::error!("[Dashboard] Could not schedule desktop restoration: {error}");
        }
    }
}

impl Drop for DashboardOverlay {
    fn drop(&mut self) {
        self.deactivate();
        let Some(destroy) = self.table.DestroyOverlay else {
            return;
        };
        if self.main == 0 {
            return;
        }
        if let Err(error) = check(unsafe { destroy(self.main) }) {
            log::warn!("[Dashboard] Could not destroy overlay: {error}");
        }
    }
}

/// Runs on the main thread: takes over the desktop WebView on first use, then captures one frame.
unsafe fn capture_frame(
    window: WebviewWindow,
    controller: ICoreWebView2Controller,
    device: Option<&ID3D11Device>,
    keyboard: KeyboardRequests,
    capture: &Arc<CaptureState>,
) -> Result<(), String> {
    DESKTOP.with(|saved| {
        DESKTOP_GENERATION.with(|generation| generation.set(generation.get() + 1));
        if saved.borrow().is_none() {
            *saved.borrow_mut() = Some(Desktop::enter(
                window,
                controller.clone(),
                device,
                keyboard,
            )?);
        }
        if let Some(gpu) = saved
            .borrow()
            .as_ref()
            .and_then(|desktop| desktop.gpu.as_ref())
        {
            if let Some(frame) = gpu.next_frame().map_err(message)? {
                *capture.frame.lock().unwrap() = Some(Ok(CapturedFrame::Gpu(frame)));
            }
            capture.busy.store(false, Ordering::Release);
            return Ok(());
        }
        capture_png(
            &controller.CoreWebView2().map_err(message)?,
            capture.clone(),
        )
    })
}

unsafe fn capture_png(webview: &ICoreWebView2, capture: Arc<CaptureState>) -> Result<(), String> {
    let stream = SHCreateMemStream(None).ok_or("Could not allocate capture stream")?;
    let output = stream.clone();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
        if capture.active.load(Ordering::Acquire) {
            let frame = result
                .map_err(message)
                .and_then(|_| read_stream(&output))
                .map(CapturedFrame::Cpu);
            *capture.frame.lock().unwrap() = Some(frame);
        }
        capture.busy.store(false, Ordering::Release);
        Ok(())
    }));
    webview
        .CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            &stream,
            &handler,
        )
        .map_err(message)
}

unsafe fn read_stream(stream: &IStream) -> Result<Vec<u8>, String> {
    let mut stat = STATSTG::default();
    stream.Stat(&mut stat, STATFLAG_NONAME).map_err(message)?;
    if stat.cbSize == 0 || stat.cbSize > MAX_PNG_BYTES {
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

fn keyboard_text(input: &[std::ffi::c_char]) -> String {
    let bytes: Vec<u8> = input
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

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

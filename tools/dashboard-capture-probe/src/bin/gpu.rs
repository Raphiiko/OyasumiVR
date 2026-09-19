#[path = "../../../../src-core/src/openvr/dashboard_capture.rs"]
mod dashboard_capture;
#[path = "../../../../src-core/src/openvr/dashboard_texture.rs"]
mod dashboard_texture;
use std::{
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::*,
    Win32::{Foundation::*, System::Com::*, UI::WindowsAndMessaging::*},
};

fn pump<T>(rx: Receiver<T>) -> std::result::Result<T, Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(value) = rx.try_recv() {
            return Ok(value);
        }
        if Instant::now() > deadline {
            return Err("callback timed out".into());
        }
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    DefWindowProcW(hwnd, message, wparam, lparam)
}

fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        RegisterClassW(&WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            lpszClassName: w!("DashboardCaptureProbe"),
            ..Default::default()
        });
        let hwnd = CreateWindowExW(
            Default::default(),
            w!("DashboardCaptureProbe"),
            w!("Dashboard capture probe"),
            WS_POPUP,
            -16000,
            -16000,
            1280,
            800,
            None,
            None,
            None,
            None,
        )?;
        let container = CreateWindowExW(
            Default::default(),
            w!("DashboardCaptureProbe"),
            w!("WebView container"),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            1280,
            800,
            Some(hwnd),
            None,
            None,
            None,
        )?;

        let (tx, rx) = mpsc::channel();
        CreateCoreWebView2Environment(&CreateCoreWebView2EnvironmentCompletedHandler::create(
            Box::new(move |result, env| {
                tx.send(result.map(|_| env.unwrap())).unwrap();
                Ok(())
            }),
        ))?;
        let env = pump(rx)??;
        let (tx, rx) = mpsc::channel();
        env.CreateCoreWebView2Controller(
            container,
            &CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
                move |result, controller| {
                    tx.send(result.map(|_| controller.unwrap())).unwrap();
                    Ok(())
                },
            )),
        )?;
        let controller = pump(rx)??;
        let controller2: ICoreWebView2Controller2 = controller.cast()?;
        controller2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
            A: 0,
            R: 0,
            G: 0,
            B: 0,
        })?;
        controller.SetBounds(RECT {
            left: 0,
            top: 0,
            right: 1280,
            bottom: 800,
        })?;
        controller.SetIsVisible(true)?;
        let webview = controller.CoreWebView2()?;
        let (tx, rx) = mpsc::channel();
        let mut token = 0;
        webview.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |_, _| {
                let _ = tx.send(());
                Ok(())
            })),
            &mut token,
        )?;
        webview.NavigateToString(w!("<html><body style='background:red;color:white;font:48px sans-serif'>Hidden window capture test</body></html>"))?;
        pump(rx)?;
        for _ in 0..2 {
            gpu_capture(container, &webview)?;
        }
        assert_eq!(GetParent(container)?, hwnd);
        assert!(!IsWindowVisible(hwnd).as_bool());
        controller.Close()?;
        DestroyWindow(hwnd)?;
    }
    Ok(())
}

unsafe fn gpu_capture(
    hwnd: HWND,
    webview: &ICoreWebView2,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::Graphics::Direct3D11::*;
    let adapter = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "0".into())
        .parse()?;
    let output = dashboard_texture::DashboardTexture::new(adapter, 1280, 800)?;
    output.upload(&[24, 24, 28, 255].repeat(1280 * 800), 1280)?;
    let device = output.device();
    let context = device.GetImmediateContext()?;
    let capture = dashboard_capture::DashboardCapture::new(hwnd, device, 1280, 800)?;
    for index in 0..6 {
        let color = if index % 2 == 0 { "red" } else { "blue" };
        let (tx, rx) = mpsc::channel();
        webview.ExecuteScript(
            &HSTRING::from(format!(
                "document.body.style.background='{color}';document.body.innerText='Frame {index}';"
            )),
            &ExecuteScriptCompletedHandler::create(Box::new(move |result, _| {
                tx.send(result).unwrap();
                Ok(())
            })),
        )?;
        pump(rx)??;
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut matched = false;
        let mut frame_count = 0;
        while Instant::now() < deadline {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if let Some(frame) = capture.next_frame()? {
                frame_count += 1;
                output.copy(&frame.texture)?;
                let texture = output.texture();
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                texture.GetDesc(&mut desc);
                desc.Usage = D3D11_USAGE_STAGING;
                desc.BindFlags = 0;
                desc.MiscFlags = 0;
                desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                let mut staging = None;
                device.CreateTexture2D(&desc, None, Some(&mut staging))?;
                let staging = staging.unwrap();
                context.CopyResource(&staging, texture);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
                let pixel = std::slice::from_raw_parts(
                    (mapped.pData as *const u8).add(mapped.RowPitch as usize * 400 + 640 * 4),
                    4,
                )
                .to_vec();
                context.Unmap(&staging, 0);
                drop(frame);
                println!(
                    "frame {index} sample={pixel:?} texture={}x{}",
                    desc.Width, desc.Height
                );
                matched = if index % 2 == 0 {
                    pixel[2] > 200 && pixel[0] < 30
                } else {
                    pixel[0] > 200 && pixel[2] < 30
                };
                if matched {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            matched,
            "GPU frame must show {color}, received {frame_count} frames"
        );
        std::thread::sleep(Duration::from_millis(500));
    }
    drop(capture);
    println!("PASS: live GPU frames from offscreen window");
    Ok(())
}

use std::{
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::Com::*,
        UI::{Shell::SHCreateMemStream, WindowsAndMessaging::*},
    },
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
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            980,
            662,
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
            980,
            662,
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
        let mut previous = Vec::new();
        for (index, color) in ["red", "blue"].iter().enumerate() {
            let script = HSTRING::from(format!(
                "document.body.style.background='{color}';document.body.innerText='Frame {index}';"
            ));
            let (tx, rx) = mpsc::channel();
            webview.ExecuteScript(
                &script,
                &ExecuteScriptCompletedHandler::create(Box::new(move |result, _| {
                    tx.send(result).unwrap();
                    Ok(())
                })),
            )?;
            pump(rx)??;
            let stream = SHCreateMemStream(None).unwrap();
            let (tx, rx) = mpsc::channel();
            let started = Instant::now();
            webview.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    tx.send(result).unwrap();
                    Ok(())
                })),
            )?;
            pump(rx)??;
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME)?;
            stream.Seek(0, STREAM_SEEK_SET, None)?;
            let mut bytes = vec![0u8; stat.cbSize as usize];
            stream
                .Read(bytes.as_mut_ptr().cast(), bytes.len() as u32, None)
                .ok()?;
            assert!(
                !IsWindowVisible(hwnd).as_bool(),
                "The probe window must stay hidden"
            );
            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
            assert_eq!(u32::from_be_bytes(bytes[16..20].try_into()?), 1280);
            assert_eq!(u32::from_be_bytes(bytes[20..24].try_into()?), 800);
            assert_ne!(bytes, previous, "The capture must reflect the changed page");
            std::fs::write(format!("frame-{index}.png"), &bytes)?;
            println!(
                "hidden={} frame={index} bytes={} elapsed={:?}",
                !IsWindowVisible(hwnd).as_bool(),
                bytes.len(),
                started.elapsed()
            );
            previous = bytes;
        }
        let (tx, rx) = mpsc::channel();
        webview.ExecuteScript(
            w!("document.body.innerHTML = '<button style=\"width:200px;height:80px\">Click test</button>'; document.querySelector('button').onclick = e => document.body.dataset.clicked = String(e.isTrusted);"),
            &ExecuteScriptCompletedHandler::create(Box::new(move |result, _| { tx.send(result).unwrap(); Ok(()) })),
        )?;
        pump(rx)??;
        for event in [
            r#"{"type":"mousePressed","x":40,"y":40,"button":"left","buttons":1,"clickCount":1}"#,
            r#"{"type":"mouseReleased","x":40,"y":40,"button":"left","buttons":0,"clickCount":1}"#,
        ] {
            let (tx, rx) = mpsc::channel();
            webview.CallDevToolsProtocolMethod(
                w!("Input.dispatchMouseEvent"),
                &HSTRING::from(event),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, _| {
                    tx.send(result).unwrap();
                    Ok(())
                })),
            )?;
            pump(rx)??;
        }
        let (tx, rx) = mpsc::channel();
        webview.ExecuteScript(
            w!("document.body.dataset.clicked"),
            &ExecuteScriptCompletedHandler::create(Box::new(move |result, value| {
                tx.send(result.map(|_| value)).unwrap();
                Ok(())
            })),
        )?;
        assert_eq!(
            pump(rx)??,
            "\"true\"",
            "Hidden WebView must receive a trusted browser click"
        );
        println!("hidden WebView received a trusted click");
        controller.Close()?;
        DestroyWindow(hwnd)?;
    }
    Ok(())
}

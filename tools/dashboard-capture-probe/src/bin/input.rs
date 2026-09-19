#[path = "../../../../src-core/src/openvr/dashboard_input.rs"]
mod dashboard_input;
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
            right: 1600,
            bottom: 900,
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
        webview.NavigateToString(&HSTRING::from(include_str!("input.html")))?;
        pump(rx)?;
        run_input_checks(&webview)?;
        assert!(!IsWindowVisible(hwnd).as_bool());
        controller.Close()?;
        DestroyWindow(hwnd)?;
    }
    Ok(())
}

fn evaluate(
    webview: &ICoreWebView2,
    script: &str,
) -> std::result::Result<String, Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel();
    unsafe {
        webview.ExecuteScript(
            &HSTRING::from(script),
            &ExecuteScriptCompletedHandler::create(Box::new(move |result, value| {
                tx.send(result.map(|_| value)).unwrap();
                Ok(())
            })),
        )?;
    }
    pump(rx)?.map_err(Into::into)
}

fn until(
    webview: &ICoreWebView2,
    condition: &str,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while evaluate(webview, condition)? != "true" {
        if Instant::now() > deadline {
            return Err(format!(
                "Input assertion timed out: {condition}; state={}",
                evaluate(webview, "JSON.stringify(state)")?
            )
            .into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

fn run_input_checks(
    webview: &ICoreWebView2,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    use dashboard_input::{DashboardInput, PointerEvent::*};
    let mut input = DashboardInput::new(webview.clone(), 1600, 900);
    let keyboard = std::sync::Arc::new(std::sync::Mutex::new(None));
    input.set_keyboard_requests(keyboard.clone());
    evaluate(webview, "(()=>{const e=document.createElement('input');e.id='entry';e.value='existing';e.maxLength=80;e.style='position:absolute;left:700px;top:40px;width:200px;height:50px';document.body.append(e);window.textEvents=[];for(const type of ['input','change','blur'])e.addEventListener(type,()=>textEvents.push(type));})()")?;
    input.handle(Move(750.0, 830.0));
    input.handle(Button {
        button: 1,
        down: true,
    });
    input.handle(Button {
        button: 1,
        down: false,
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    while keyboard.lock().unwrap().is_none() {
        evaluate(webview, "0")?;
        assert!(Instant::now() < deadline, "keyboard request missing");
    }
    let request = keyboard.lock().unwrap().take().unwrap();
    assert_eq!(
        evaluate(
            webview,
            "document.getElementById('entry').value==='existing'"
        )?,
        "true"
    );
    assert_eq!(request.max_length, 80);
    assert!(!request.password && !request.multiline);
    evaluate(webview, "document.getElementById('entry').select()")?;
    for text in ["日本語", " café ", "💤"] {
        input.handle(KeyboardKey {
            id: request.id,
            text: text.into(),
        });
    }
    until(
        webview,
        "document.getElementById('entry').value==='日本語 café 💤'",
    )?;
    input.handle(KeyboardKey {
        id: request.id,
        text: "\x08".into(),
    });
    input.handle(KeyboardKey {
        id: request.id,
        text: "\x1b[D".into(),
    });
    input.handle(KeyboardKey {
        id: request.id,
        text: "!".into(),
    });
    until(
        webview,
        "document.getElementById('entry').value==='日本語 café! '",
    )?;
    input.handle(KeyboardDone { id: request.id });
    until(webview, "document.getElementById('entry').value==='日本語 café! ' && textEvents.slice(-2).join(',')==='change,blur'")?;
    println!(
        "PASS: editable field requests keyboard and applies Unicode with input/change/blur events"
    );
    for (kind, password, multiline) in [("password", true, false), ("textarea", false, true)] {
        evaluate(webview, &format!("(()=>{{const old=document.getElementById('entry');const e=document.createElement('{}');{}e.id='entry';e.style=old.style.cssText;old.replaceWith(e);}})()", if multiline { "textarea" } else { "input" }, if password { "e.type='password';" } else { "" }))?;
        input.handle(Move(750.0, 830.0));
        input.handle(Button {
            button: 1,
            down: true,
        });
        input.handle(Button {
            button: 1,
            down: false,
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while keyboard.lock().unwrap().is_none() {
            evaluate(webview, "0")?;
            assert!(Instant::now() < deadline, "{kind} keyboard request missing");
        }
        let next = keyboard.lock().unwrap().take().unwrap();
        assert_eq!(next.password, password);
        assert_eq!(next.multiline, multiline);
        input.handle(KeyboardKey {
            id: request.id,
            text: "stale".into(),
        });
        for character in (if multiline {
            "first\nsecond"
        } else {
            "private"
        })
        .chars()
        {
            input.handle(KeyboardKey {
                id: next.id,
                text: character.to_string(),
            });
        }
        input.handle(KeyboardDone { id: next.id });
        until(
            webview,
            if multiline {
                "document.getElementById('entry').value==='first\\nsecond'"
            } else {
                "document.getElementById('entry').value==='private'"
            },
        )?;
    }
    evaluate(
        webview,
        "document.getElementById('entry').readOnly=true;document.getElementById('entry').focus()",
    )?;
    let rejected = evaluate(
        webview,
        include_str!("../../../../src-core/src/openvr/dashboard_keyboard.js"),
    )?;
    assert_eq!(rejected, "null");
    evaluate(webview, "document.getElementById('entry').remove()")?;
    println!("PASS: password/multiline modes, stale-session rejection and read-only exclusion");

    input.handle(Move(60.0, 840.0));
    input.handle(Button {
        button: 1,
        down: true,
    });
    input.handle(Button {
        button: 1,
        down: false,
    });
    until(webview,"state.clicks===1 && state.hover && state.trusted && document.documentElement.dataset.vrDashboard==='true'")?;
    println!("PASS: trusted hover and click at converted OpenVR coordinates");

    input.handle(Move(60.0, 680.0));
    input.handle(Button {
        button: 1,
        down: true,
    });
    for x in 60..300 {
        input.handle(Move(x as f32, 650.0));
    }
    input.handle(Button {
        button: 1,
        down: false,
    });
    until(
        webview,
        "state.dragX===299 && state.dragButtons===1 && state.buttons===0 && state.dragReleased",
    )?;
    println!("PASS: ordered drag with held button through coalesced moves");

    evaluate(webview, "window.scrollSamples=[]; document.getElementById('scroll').addEventListener('scroll',()=>scrollSamples.push([performance.now(),document.getElementById('scroll').scrollTop]))")?;
    input.handle(Move(450.0, 800.0));
    let scroll_started = Instant::now();
    for step in 0..100 {
        input.handle(Move(450.0 + (step % 20) as f32, 800.0));
        input.handle(Scroll(0.0, -0.02));
    }
    until(
        webview,
        "Math.abs(document.getElementById('scroll').scrollTop-240)<2",
    )?;
    assert!(
        scroll_started.elapsed() < Duration::from_secs(1),
        "scroll events queued for {:?}",
        scroll_started.elapsed()
    );
    println!(
        "PASS: fractional controller scroll preserves accumulated distance in {:?}",
        scroll_started.elapsed()
    );

    until(
        webview,
        "scrollSamples.filter(sample=>sample[1]>0 && sample[1]<239).length>=3",
    )?;
    println!("PASS: scroll distance spreads across multiple browser frames");
    evaluate(
        webview,
        "document.getElementById('scroll').firstElementChild.style.height='20000px'",
    )?;
    evaluate(webview, "window.scrollFrames=[];window.sampleScroll=true;requestAnimationFrame(function sample(t){scrollFrames.push([t,document.getElementById('scroll').scrollTop]);if(sampleScroll)requestAnimationFrame(sample)})")?;
    for step in 0..90 {
        input.handle(Move(450.0 + (step % 20) as f32, 800.0));
        input.handle(Scroll(0.0, -0.05));
        let next_input = Instant::now() + Duration::from_millis(11);
        while Instant::now() < next_input {
            unsafe {
                let mut message = MSG::default();
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    evaluate(webview, "window.sampleScroll=false")?;
    let cadence = evaluate(webview, "(()=>{const a=scrollFrames.slice(10,-5);return a.length>=30 && a.slice(1).filter((v,i)=>v[1]===a[i][1]).length/a.length<0.1})()")?;
    assert_eq!(
        cadence, "true",
        "sustained scrolling stalled between gestures"
    );
    println!("PASS: sustained scrolling advances on over 90% of browser frames");
    let stopped = Instant::now();
    until(
        webview,
        "Math.abs(document.getElementById('scroll').scrollTop-780)<3",
    )?;
    assert!(
        stopped.elapsed() < Duration::from_millis(350),
        "scroll did not settle promptly"
    );
    println!(
        "PASS: sustained scrolling settles in {:?}",
        stopped.elapsed()
    );

    evaluate(
        webview,
        "document.getElementById('scroll').firstElementChild.style.width='2000px'",
    )?;
    input.handle(Scroll(-2.0, 0.0));
    until(
        webview,
        "Math.abs(document.getElementById('scroll').scrollLeft-240)<2",
    )?;
    input.handle(Scroll(0.0, -8.0));
    until(webview, "document.getElementById('scroll').scrollTop>800")?;
    input.handle(Leave);
    until(webview, "state.buttons===0")?;
    evaluate(webview, "window.cancelledScroll=document.getElementById('scroll').scrollTop;window.cancelledAt=performance.now()")?;
    until(webview, "performance.now()-cancelledAt>150")?;
    assert_eq!(
        evaluate(
            webview,
            "document.getElementById('scroll').scrollTop===cancelledScroll"
        )?,
        "true"
    );
    println!("PASS: horizontal scrolling and cancellation of active scrolling");

    input.handle(Move(60.0, 680.0));
    input.handle(Button {
        button: 1,
        down: true,
    });
    until(webview, "state.buttons===1")?;
    input.handle(Leave);
    until(webview, "state.buttons===0")?;
    println!("PASS: leaving the panel releases held buttons");

    input.handle(Move(60.0, 680.0));
    input.handle(Button {
        button: 1,
        down: true,
    });
    until(webview, "state.buttons===1")?;
    input.finish();
    let mut next = DashboardInput::new(webview.clone(), 1600, 900);
    until(
        webview,
        "state.buttons===0 && document.documentElement.dataset.vrDashboard==='true'",
    )?;
    next.handle(Move(60.0, 840.0));
    next.handle(Button {
        button: 1,
        down: true,
    });
    next.handle(Button {
        button: 1,
        down: false,
    });
    until(webview, "state.clicks===2 && state.buttons===0")?;
    next.finish();
    until(
        webview,
        "!document.documentElement.hasAttribute('data-vr-dashboard') && !window.__oyasumiDashboardScroll && state.buttons===0",
    )?;
    println!("PASS: held-button cleanup and immediate dashboard re-entry");
    Ok(())
}

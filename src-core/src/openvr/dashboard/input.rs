use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::VecDeque,
    rc::{Rc, Weak},
    sync::{Arc, Mutex},
    time::Instant,
};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2,
};
use windows::core::HSTRING;

pub enum PointerEvent {
    Move(f32, f32),
    Button { button: u32, down: bool },
    Scroll(f32, f32),
    Leave,
    KeyboardKey { id: u64, text: String },
    KeyboardDone { id: u64 },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardRequest {
    pub id: u64,
    pub password: bool,
    pub multiline: bool,
    pub max_length: u32,
}
pub type KeyboardRequests = Arc<Mutex<Option<KeyboardRequest>>>;

pub struct DashboardInput {
    queue: Rc<RefCell<Queue>>,
    width: f32,
    height: f32,
    x: f32,
    y: f32,
    buttons: u32,
    last_click: Option<(Instant, f32, f32, u32)>,
    click_count: u32,
}

thread_local! {
    static INPUT_QUEUE: RefCell<Weak<RefCell<Queue>>> = const { RefCell::new(Weak::new()) };
}

struct Queue {
    webview: ICoreWebView2,
    pending: VecDeque<(&'static str, Value)>,
    in_flight: bool,
    sent_buttons: u32,
    sent_keys: Vec<Value>,
    keyboard: Option<KeyboardRequests>,
    keyboard_generation: u64,
}

impl DashboardInput {
    pub fn new(webview: ICoreWebView2, width: u32, height: u32) -> Self {
        let input = Self {
            queue: INPUT_QUEUE.with(|saved| {
                if let Some(queue) = saved.borrow().upgrade() {
                    if queue.borrow().webview == webview {
                        return queue;
                    }
                }
                let queue = Rc::new(RefCell::new(Queue {
                    webview,
                    pending: VecDeque::new(),
                    in_flight: false,
                    sent_buttons: 0,
                    sent_keys: Vec::new(),
                    keyboard: None,
                    keyboard_generation: 0,
                }));
                *saved.borrow_mut() = Rc::downgrade(&queue);
                queue
            }),
            width: width as f32,
            height: height as f32,
            x: -1.0,
            y: -1.0,
            buttons: 0,
            last_click: None,
            click_count: 1,
        };
        input.queue.borrow_mut().keyboard_generation += 1;
        input.enqueue(
            "Runtime.evaluate",
            json!({"expression": include_str!("scroll.js")}),
        );
        input
    }

    pub fn set_keyboard_requests(&self, requests: KeyboardRequests) {
        self.queue.borrow_mut().keyboard = Some(requests);
    }

    pub fn handle(&mut self, event: PointerEvent) {
        match event {
            PointerEvent::Move(x, y) => {
                if self.position(x, y) {
                    self.mouse("mouseMoved", "none", 0);
                }
            }
            PointerEvent::Button { button, down } => {
                let name = match button {
                    1 => "left",
                    2 => "right",
                    4 => "middle",
                    _ => return,
                };
                if self.x < 0.0 || self.y < 0.0 || (self.buttons & button != 0) == down {
                    return;
                }
                if down {
                    let double_click = self.last_click.is_some_and(|(when, x, y, previous)| {
                        previous == button
                            && when.elapsed().as_millis() < 500
                            && (self.x - x).abs() < 4.0
                            && (self.y - y).abs() < 4.0
                    });
                    self.click_count = if double_click { 2 } else { 1 };
                    self.last_click = if double_click {
                        None
                    } else {
                        Some((Instant::now(), self.x, self.y, button))
                    };
                    self.buttons |= button;
                } else {
                    self.buttons &= !button;
                }
                self.mouse(
                    if down {
                        "mousePressed"
                    } else {
                        "mouseReleased"
                    },
                    name,
                    self.click_count,
                );
                if button == 1 && !down {
                    self.enqueue("Runtime.evaluate", json!({
                        "expression": format!("document.elementFromPoint({},{})?.closest('input,textarea') === document.activeElement ? (() => {{ return {} }})() : null", self.x, self.y, include_str!("keyboard.js")),
                        "returnByValue": true, "objectGroup": "oyasumi-dashboard-keyboard"
                    }));
                }
            }
            PointerEvent::Scroll(x, y) => {
                if !x.is_finite()
                    || !y.is_finite()
                    || (x == 0.0 && y == 0.0)
                    || self.x < 0.0
                    || self.y < 0.0
                {
                    return;
                }
                self.enqueue(
                    "Input.dispatchMouseEvent",
                    json!({
                        "type": "mouseWheel", "x": self.x, "y": self.y, "buttons": self.buttons,
                        "deltaX": -120.0 * x, "deltaY": -120.0 * y,
                    }),
                );
            }
            PointerEvent::KeyboardKey { id, text } => {
                self.enqueue("Dashboard.keyboard", json!({ "id": id, "text": text }))
            }
            PointerEvent::KeyboardDone { id } => self.enqueue(
                "Runtime.evaluate",
                json!({
                    "expression": format!("window.__oyasumiDashboardKeyboard?.finish({id})")
                }),
            ),
            PointerEvent::Leave => self.release(),
        }
    }

    pub fn finish(&mut self) {
        {
            let mut queue = self.queue.borrow_mut();
            queue.keyboard_generation += 1;
            queue.pending.retain(|(method, params)| {
                !matches!(
                    *method,
                    "Dashboard.keyboard" | "Input.insertText" | "Input.dispatchKeyEvent"
                ) && params["objectGroup"] != "oyasumi-dashboard-keyboard"
            });
            for release in queue.sent_keys.clone().into_iter().rev() {
                queue
                    .pending
                    .push_front(("Input.dispatchKeyEvent", release));
            }
        }
        self.release();
        self.enqueue(
            "Runtime.evaluate",
            json!({"expression": "window.__oyasumiDashboardScroll?.dispose(); delete window.__oyasumiDashboardKeyboard; delete document.documentElement.dataset.vrDashboard"}),
        );
    }

    fn position(&mut self, x: f32, y: f32) -> bool {
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        self.x = x.clamp(0.0, self.width - 1.0);
        self.y = (self.height - y).clamp(0.0, self.height - 1.0);
        true
    }

    fn release(&mut self) {
        {
            let mut queue = self.queue.borrow_mut();
            queue
                .pending
                .retain(|(method, _)| *method != "Input.dispatchMouseEvent");
            self.buttons = queue.sent_buttons;
        }
        self.enqueue(
            "Runtime.evaluate",
            json!({"expression": "window.__oyasumiDashboardScroll?.cancel()"}),
        );
        self.x = -1.0;
        self.y = -1.0;
        self.mouse("mouseMoved", "none", 0);
        for (button, name) in [(1, "left"), (2, "right"), (4, "middle")] {
            if self.buttons & button != 0 {
                self.buttons &= !button;
                self.mouse("mouseReleased", name, 0);
            }
        }
        self.last_click = None;
    }

    fn mouse(&self, kind: &str, button: &str, clicks: u32) {
        self.enqueue(
            "Input.dispatchMouseEvent",
            json!({
                "type": kind, "x": self.x, "y": self.y, "button": button,
                "buttons": self.buttons, "clickCount": clicks,
            }),
        );
    }

    fn enqueue(&self, method: &'static str, params: Value) {
        {
            let mut queue = self.queue.borrow_mut();
            let mut params = params;
            if params["type"] == "mouseMoved" || params["type"] == "mouseWheel" {
                let previous = queue
                    .pending
                    .iter()
                    .enumerate()
                    .rev()
                    .take_while(|(_, (pending_method, pending))| {
                        *pending_method == "Input.dispatchMouseEvent"
                            && (pending["type"] == "mouseMoved" || pending["type"] == "mouseWheel")
                            && pending["buttons"] == params["buttons"]
                    })
                    .find(|(_, (_, pending))| pending["type"] == params["type"])
                    .map(|(index, _)| index);
                if let Some(index) = previous {
                    let previous = &queue.pending[index].1;
                    if params["type"] == "mouseWheel" {
                        for axis in ["deltaX", "deltaY"] {
                            params[axis] = json!(
                                previous[axis].as_f64().unwrap() + params[axis].as_f64().unwrap()
                            );
                        }
                    }
                    queue.pending[index].1 = params;
                    return;
                }
            }
            queue.pending.push_back((method, params));
        }
        dispatch(self.queue.clone());
    }
}

fn dispatch(queue: Rc<RefCell<Queue>>) {
    loop {
        let (webview, method, params, released_button, released_key) = {
            let mut state = queue.borrow_mut();
            if state.in_flight {
                return;
            }
            let Some((method, params)) = state.pending.pop_front() else {
                return;
            };
            state.in_flight = true;
            let button = match params["button"].as_str() {
                Some("left") => 1,
                Some("right") => 2,
                Some("middle") => 4,
                _ => 0,
            };
            if method == "Input.dispatchMouseEvent" && params["type"] == "mousePressed" {
                state.sent_buttons |= button;
            }
            if method == "Input.dispatchKeyEvent"
                && params["type"] == "keyDown"
                && !state
                    .sent_keys
                    .iter()
                    .any(|key| key["code"] == params["code"])
            {
                state.sent_keys.push(json!({
                    "type": "keyUp", "key": params["key"], "code": params["code"],
                    "windowsVirtualKeyCode": params["windowsVirtualKeyCode"]
                }));
            }
            let released_button =
                if method == "Input.dispatchMouseEvent" && params["type"] == "mouseReleased" {
                    button
                } else {
                    0
                };
            let released_key = (method == "Input.dispatchKeyEvent" && params["type"] == "keyUp")
                .then(|| params["code"].clone());
            (
                state.webview.clone(),
                method,
                params,
                released_button,
                released_key,
            )
        };
        let keyboard_key =
            (method == "Dashboard.keyboard").then(|| params["text"].as_str().unwrap().to_owned());
        let (method, params) = if method == "Dashboard.keyboard" {
            (
                "Runtime.evaluate",
                json!({"expression": format!("window.__oyasumiDashboardKeyboard?.accepts({}) === true", params["id"]), "returnByValue": true}),
            )
        } else if params["type"] == "mouseWheel" {
            (
                "Runtime.evaluate",
                json!({"expression": format!(
                    "window.__oyasumiDashboardScroll?.scroll({},{},{},{})",
                    params["x"], params["y"], params["deltaX"], params["deltaY"]
                )}),
            )
        } else {
            (method, params)
        };
        let keyboard_query = params["objectGroup"] == "oyasumi-dashboard-keyboard";
        let keyboard_mailbox = queue.borrow().keyboard.clone();
        let keyboard_generation = queue.borrow().keyboard_generation;
        let callback_queue = queue.clone();
        let result = unsafe {
            webview.CallDevToolsProtocolMethod(
                &HSTRING::from(method),
                &HSTRING::from(params.to_string()),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, response| {
                        if result.is_ok()
                            && keyboard_query
                            && callback_queue.borrow().keyboard_generation == keyboard_generation
                        {
                            if let Ok(value) = serde_json::from_str::<Value>(&response) {
                                if let Ok(request) = serde_json::from_value::<KeyboardRequest>(
                                    value["result"]["value"].clone(),
                                ) {
                                    if let Some(mailbox) = &keyboard_mailbox {
                                        *mailbox.lock().unwrap() = Some(request);
                                    }
                                }
                            }
                        }
                        {
                            let mut state = callback_queue.borrow_mut();
                            if result.is_ok() {
                                state.sent_buttons &= !released_button;
                                if let Some(code) = &released_key {
                                    state.sent_keys.retain(|key| key["code"] != *code);
                                }
                            }
                            if result.is_ok() && state.keyboard_generation == keyboard_generation {
                                if let Some(text) = &keyboard_key {
                                    if serde_json::from_str::<Value>(&response)
                                        .ok()
                                        .is_some_and(|value| value["result"]["value"] == true)
                                    {
                                        let commands = keyboard_commands(text);
                                        for command in commands.into_iter().rev() {
                                            state.pending.push_front(command);
                                        }
                                    }
                                }
                            }
                            state.in_flight = false;
                        }
                        if let Err(error) = result {
                            log::warn!("[Dashboard] Browser input failed: {error}");
                        }
                        dispatch(callback_queue.clone());
                        Ok(())
                    },
                )),
            )
        };
        if let Err(error) = result {
            let mut state = queue.borrow_mut();
            state.in_flight = false;
            log::warn!("[Dashboard] Could not dispatch browser input: {error}");
        } else {
            return;
        }
    }
}

fn keyboard_commands(text: &str) -> Vec<(&'static str, Value)> {
    let key = match text {
        "\x08" => Some(("Backspace", "Backspace", 8)),
        "\x7f" | "\x1b[3~" => Some(("Delete", "Delete", 46)),
        "\r" | "\n" | "\r\n" => Some(("Enter", "Enter", 13)),
        "\t" => Some(("Tab", "Tab", 9)),
        "\x1b[D" => Some(("ArrowLeft", "ArrowLeft", 37)),
        "\x1b[C" => Some(("ArrowRight", "ArrowRight", 39)),
        "\x1b[A" => Some(("ArrowUp", "ArrowUp", 38)),
        "\x1b[B" => Some(("ArrowDown", "ArrowDown", 40)),
        "\x1b[H" => Some(("Home", "Home", 36)),
        "\x1b[F" => Some(("End", "End", 35)),
        _ => None,
    };
    if let Some((key, code, virtual_key)) = key {
        let mut down =
            json!({"type":"keyDown", "key":key, "code":code, "windowsVirtualKeyCode":virtual_key});
        if key == "Enter" {
            down["text"] = json!("\r");
        }
        vec![
            ("Input.dispatchKeyEvent", down),
            (
                "Input.dispatchKeyEvent",
                json!({"type":"keyUp", "key":key, "code":code, "windowsVirtualKeyCode":virtual_key}),
            ),
        ]
    } else if text.chars().any(char::is_control) || text.is_empty() {
        Vec::new()
    } else {
        vec![("Input.insertText", json!({"text":text}))]
    }
}

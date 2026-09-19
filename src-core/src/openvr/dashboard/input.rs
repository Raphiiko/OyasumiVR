use serde_json::{json, Value};
use std::{
    cell::RefCell,
    collections::VecDeque,
    mem::discriminant,
    rc::{Rc, Weak},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2,
};
use windows::core::HSTRING;

const LEFT: u32 = 1;
const RIGHT: u32 = 2;
const MIDDLE: u32 = 4;
const DOUBLE_CLICK_INTERVAL: Duration = Duration::from_millis(500);
const DOUBLE_CLICK_DISTANCE: f32 = 4.0;
const WHEEL_STEP: f32 = 120.0;

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
/// Mailbox the page fills when a focused text field wants the SteamVR keyboard.
pub type KeyboardRequests = Arc<Mutex<Option<KeyboardRequest>>>;

/// Turns dashboard events into browser input for one dashboard session.
pub struct DashboardInput {
    queue: Rc<RefCell<Queue>>,
    width: f32,
    height: f32,
    x: f32,
    y: f32,
    buttons: u32,
    last_click: Option<Click>,
    click_count: u32,
}

#[derive(Clone, Copy)]
struct Click {
    at: Instant,
    x: f32,
    y: f32,
    button: u32,
}

impl DashboardInput {
    pub fn new(
        webview: ICoreWebView2,
        width: u32,
        height: u32,
        keyboard: KeyboardRequests,
    ) -> Self {
        let queue = Queue::shared(webview, keyboard);
        let input = Self {
            queue,
            width: width as f32,
            height: height as f32,
            x: -1.0,
            y: -1.0,
            buttons: 0,
            last_click: None,
            click_count: 1,
        };
        input.enqueue(Command::Evaluate(include_str!("scroll.js").into()));
        input
    }

    pub fn handle(&mut self, event: PointerEvent) {
        match event {
            PointerEvent::Move(x, y) => {
                if self.move_pointer(x, y) {
                    self.mouse(MouseKind::Moved, 0, 0);
                }
            }
            PointerEvent::Button { button, down } => self.button(button, down),
            PointerEvent::Scroll(x, y) => self.scroll(x, y),
            PointerEvent::KeyboardKey { id, text } => {
                self.enqueue(Command::KeyboardText { id, text });
            }
            PointerEvent::KeyboardDone { id } => self.enqueue(Command::Evaluate(format!(
                "window.__oyasumiDashboardKeyboard?.finish({id})"
            ))),
            PointerEvent::Leave => self.release(),
        }
    }

    /// Releases held input and removes the page hooks; the queue outlives this session.
    pub fn finish(&mut self) {
        {
            let mut queue = self.queue.borrow_mut();
            queue.keyboard_generation += 1;
            queue.pending.retain(|command| {
                !matches!(
                    command,
                    Command::Key(_)
                        | Command::InsertText(_)
                        | Command::KeyboardQuery(_)
                        | Command::KeyboardText { .. }
                )
            });
            for key in queue.held_keys.clone().into_iter().rev() {
                queue.pending.push_front(Command::Key(key));
            }
        }
        self.release();
        self.enqueue(Command::Evaluate(
            "window.__oyasumiDashboardScroll?.dispose(); \
             delete window.__oyasumiDashboardKeyboard; \
             delete document.documentElement.dataset.vrDashboard"
                .into(),
        ));
    }

    fn pointer_inside(&self) -> bool {
        self.x >= 0.0 && self.y >= 0.0
    }

    fn move_pointer(&mut self, x: f32, y: f32) -> bool {
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        self.x = x.clamp(0.0, self.width - 1.0);
        self.y = (self.height - y).clamp(0.0, self.height - 1.0);
        true
    }

    fn button(&mut self, button: u32, down: bool) {
        if !matches!(button, LEFT | RIGHT | MIDDLE) || !self.pointer_inside() {
            return;
        }
        if (self.buttons & button != 0) == down {
            return;
        }
        if down {
            let double_click = self.last_click.is_some_and(|click| {
                click.button == button
                    && click.at.elapsed() < DOUBLE_CLICK_INTERVAL
                    && (self.x - click.x).abs() < DOUBLE_CLICK_DISTANCE
                    && (self.y - click.y).abs() < DOUBLE_CLICK_DISTANCE
            });
            self.click_count = if double_click { 2 } else { 1 };
            self.last_click = (!double_click).then(|| Click {
                at: Instant::now(),
                x: self.x,
                y: self.y,
                button,
            });
            self.buttons |= button;
            self.mouse(MouseKind::Pressed, button, self.click_count);
        } else {
            self.buttons &= !button;
            self.mouse(MouseKind::Released, button, self.click_count);
            if button == LEFT {
                self.enqueue(Command::KeyboardQuery(keyboard_query(self.x, self.y)));
            }
        }
    }

    fn scroll(&mut self, x: f32, y: f32) {
        if !x.is_finite() || !y.is_finite() || (x == 0.0 && y == 0.0) || !self.pointer_inside() {
            return;
        }
        self.enqueue(Command::Wheel(WheelEvent {
            x: self.x.into(),
            y: self.y.into(),
            buttons: self.buttons,
            delta_x: (-WHEEL_STEP * x).into(),
            delta_y: (-WHEEL_STEP * y).into(),
        }));
    }

    /// Moves the pointer off the page and releases every button the browser still holds.
    fn release(&mut self) {
        {
            let mut queue = self.queue.borrow_mut();
            queue
                .pending
                .retain(|command| !matches!(command, Command::Mouse(_) | Command::Wheel(_)));
            self.buttons = queue.held_buttons;
        }
        self.enqueue(Command::Evaluate(
            "window.__oyasumiDashboardScroll?.cancel()".into(),
        ));
        self.x = -1.0;
        self.y = -1.0;
        self.mouse(MouseKind::Moved, 0, 0);
        for button in [LEFT, RIGHT, MIDDLE] {
            if self.buttons & button != 0 {
                self.buttons &= !button;
                self.mouse(MouseKind::Released, button, 0);
            }
        }
        self.last_click = None;
    }

    fn mouse(&self, kind: MouseKind, button: u32, clicks: u32) {
        self.enqueue(Command::Mouse(MouseEvent {
            kind,
            x: self.x,
            y: self.y,
            button,
            buttons: self.buttons,
            clicks,
        }));
    }

    fn enqueue(&self, command: Command) {
        self.queue.borrow_mut().push(command);
        dispatch(self.queue.clone());
    }
}

/// One DevTools protocol call to the page.
enum Command {
    Mouse(MouseEvent),
    Wheel(WheelEvent),
    Key(KeyEvent),
    InsertText(String),
    Evaluate(String),
    /// Runs `keyboard.js`; a non-null result is a `KeyboardRequest`.
    KeyboardQuery(String),
    /// A key from the SteamVR keyboard, typed once the page confirms the request is still current.
    KeyboardText {
        id: u64,
        text: String,
    },
}

#[derive(Clone, Copy, PartialEq)]
enum MouseKind {
    Moved,
    Pressed,
    Released,
}

struct MouseEvent {
    kind: MouseKind,
    x: f32,
    y: f32,
    button: u32,
    buttons: u32,
    clicks: u32,
}

struct WheelEvent {
    x: f64,
    y: f64,
    buttons: u32,
    delta_x: f64,
    delta_y: f64,
}

#[derive(Clone)]
struct KeyEvent {
    down: bool,
    key: &'static str,
    virtual_key: u32,
}

impl Command {
    fn protocol(&self) -> (&'static str, String) {
        match self {
            Command::Mouse(event) => ("Input.dispatchMouseEvent", event.to_json().to_string()),
            Command::Wheel(event) => {
                let WheelEvent {
                    x,
                    y,
                    delta_x,
                    delta_y,
                    ..
                } = event;
                let expression =
                    format!("window.__oyasumiDashboardScroll?.scroll({x},{y},{delta_x},{delta_y})");
                ("Runtime.evaluate", json!({ "expression": expression }).to_string())
            }
            Command::Key(event) => ("Input.dispatchKeyEvent", event.to_json().to_string()),
            Command::InsertText(text) => ("Input.insertText", json!({ "text": text }).to_string()),
            Command::Evaluate(expression) => (
                "Runtime.evaluate",
                json!({ "expression": expression }).to_string(),
            ),
            Command::KeyboardQuery(expression) => (
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "returnByValue": true,
                    "objectGroup": "oyasumi-dashboard-keyboard",
                })
                .to_string(),
            ),
            Command::KeyboardText { id, .. } => (
                "Runtime.evaluate",
                json!({
                    "expression": format!("window.__oyasumiDashboardKeyboard?.accepts({id}) === true"),
                    "returnByValue": true,
                })
                .to_string(),
            ),
        }
    }

    /// Pointer moves and wheel steps merge with a pending one that holds the same buttons.
    fn stream_buttons(&self) -> Option<u32> {
        match self {
            Command::Mouse(event) if event.kind == MouseKind::Moved => Some(event.buttons),
            Command::Wheel(event) => Some(event.buttons),
            _ => None,
        }
    }
}

impl MouseEvent {
    fn to_json(&self) -> Value {
        let kind = match self.kind {
            MouseKind::Moved => "mouseMoved",
            MouseKind::Pressed => "mousePressed",
            MouseKind::Released => "mouseReleased",
        };
        json!({
            "type": kind,
            "x": self.x,
            "y": self.y,
            "button": button_name(self.button),
            "buttons": self.buttons,
            "clickCount": self.clicks,
        })
    }
}

impl KeyEvent {
    fn release(&self) -> Self {
        Self {
            down: false,
            ..self.clone()
        }
    }

    fn to_json(&self) -> Value {
        let mut json = json!({
            "type": if self.down { "keyDown" } else { "keyUp" },
            "key": self.key,
            "code": self.key,
            "windowsVirtualKeyCode": self.virtual_key,
        });
        if self.down && self.key == "Enter" {
            json["text"] = json!("\r");
        }
        json
    }
}

fn button_name(button: u32) -> &'static str {
    match button {
        LEFT => "left",
        RIGHT => "right",
        MIDDLE => "middle",
        _ => "none",
    }
}

fn keyboard_query(x: f32, y: f32) -> String {
    format!(
        "document.elementFromPoint({x},{y})?.closest('input,textarea') === document.activeElement \
         ? (() => {{ return {} }})() : null",
        include_str!("keyboard.js")
    )
}

fn keyboard_commands(text: &str) -> Vec<Command> {
    let special = match text {
        "\x08" => Some(("Backspace", 8)),
        "\x7f" | "\x1b[3~" => Some(("Delete", 46)),
        "\r" | "\n" | "\r\n" => Some(("Enter", 13)),
        "\t" => Some(("Tab", 9)),
        "\x1b[D" => Some(("ArrowLeft", 37)),
        "\x1b[C" => Some(("ArrowRight", 39)),
        "\x1b[A" => Some(("ArrowUp", 38)),
        "\x1b[B" => Some(("ArrowDown", 40)),
        "\x1b[H" => Some(("Home", 36)),
        "\x1b[F" => Some(("End", 35)),
        _ => None,
    };
    match special {
        Some((key, virtual_key)) => {
            let down = KeyEvent {
                down: true,
                key,
                virtual_key,
            };
            let up = down.release();
            vec![Command::Key(down), Command::Key(up)]
        }
        None if text.is_empty() || text.chars().any(char::is_control) => Vec::new(),
        None => vec![Command::InsertText(text.to_owned())],
    }
}

thread_local! {
    static SHARED_QUEUE: RefCell<Weak<RefCell<Queue>>> = const { RefCell::new(Weak::new()) };
}

/// Serialises protocol calls to one WebView and remembers what the browser still holds.
struct Queue {
    webview: ICoreWebView2,
    pending: VecDeque<Command>,
    in_flight: bool,
    held_buttons: u32,
    held_keys: Vec<KeyEvent>,
    keyboard: KeyboardRequests,
    keyboard_generation: u64,
}

impl Queue {
    /// Reuses the queue of a previous session on the same WebView so owed releases still go out.
    fn shared(webview: ICoreWebView2, keyboard: KeyboardRequests) -> Rc<RefCell<Self>> {
        SHARED_QUEUE.with(|saved| {
            let existing = saved
                .borrow()
                .upgrade()
                .filter(|queue| queue.borrow().webview == webview);
            let queue = existing.unwrap_or_else(|| {
                let queue = Rc::new(RefCell::new(Queue {
                    webview,
                    pending: VecDeque::new(),
                    in_flight: false,
                    held_buttons: 0,
                    held_keys: Vec::new(),
                    keyboard: keyboard.clone(),
                    keyboard_generation: 0,
                }));
                *saved.borrow_mut() = Rc::downgrade(&queue);
                queue
            });
            let mut state = queue.borrow_mut();
            state.keyboard = keyboard;
            state.keyboard_generation += 1;
            drop(state);
            queue
        })
    }

    fn push(&mut self, mut command: Command) {
        let Some(buttons) = command.stream_buttons() else {
            self.pending.push_back(command);
            return;
        };
        let previous = self
            .pending
            .iter_mut()
            .rev()
            .take_while(|pending| pending.stream_buttons() == Some(buttons))
            .find(|pending| discriminant(&**pending) == discriminant(&command));
        let Some(previous) = previous else {
            self.pending.push_back(command);
            return;
        };
        if let (Command::Wheel(merged), Command::Wheel(earlier)) = (&mut command, &*previous) {
            merged.delta_x += earlier.delta_x;
            merged.delta_y += earlier.delta_y;
        }
        *previous = command;
    }

    fn start_next(&mut self) -> Option<(ICoreWebView2, Command)> {
        if self.in_flight {
            return None;
        }
        let command = self.pending.pop_front()?;
        self.in_flight = true;
        match &command {
            Command::Mouse(event) if event.kind == MouseKind::Pressed => {
                self.held_buttons |= event.button;
            }
            Command::Key(key) if key.down && !self.holds_key(key.key) => {
                self.held_keys.push(key.release());
            }
            _ => {}
        }
        Some((self.webview.clone(), command))
    }

    fn complete(&mut self, command: &Command, generation: u64, response: &str) {
        let value = || {
            serde_json::from_str::<Value>(response).map(|value| value["result"]["value"].clone())
        };
        match command {
            Command::Mouse(event) if event.kind == MouseKind::Released => {
                self.held_buttons &= !event.button;
            }
            Command::Key(key) if !key.down => {
                self.held_keys.retain(|held| held.key != key.key);
            }
            Command::KeyboardQuery(_) if generation == self.keyboard_generation => {
                if let Ok(request) = value().and_then(serde_json::from_value::<KeyboardRequest>) {
                    *self.keyboard.lock().unwrap() = Some(request);
                }
            }
            Command::KeyboardText { text, .. }
                if generation == self.keyboard_generation
                    && value().is_ok_and(|accepted| accepted == true) =>
            {
                for command in keyboard_commands(text).into_iter().rev() {
                    self.pending.push_front(command);
                }
            }
            _ => {}
        }
    }

    fn holds_key(&self, key: &str) -> bool {
        self.held_keys.iter().any(|held| held.key == key)
    }
}

fn dispatch(queue: Rc<RefCell<Queue>>) {
    loop {
        let Some((webview, command)) = queue.borrow_mut().start_next() else {
            return;
        };
        let generation = queue.borrow().keyboard_generation;
        let (method, params) = command.protocol();
        let callback_queue = queue.clone();
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
            move |result, response| {
                {
                    let mut state = callback_queue.borrow_mut();
                    match &result {
                        Ok(()) => state.complete(&command, generation, &response),
                        Err(error) => log::warn!("[Dashboard] Browser input failed: {error}"),
                    }
                    state.in_flight = false;
                }
                dispatch(callback_queue.clone());
                Ok(())
            },
        ));
        let sent = unsafe {
            webview.CallDevToolsProtocolMethod(
                &HSTRING::from(method),
                &HSTRING::from(params),
                &handler,
            )
        };
        match sent {
            Ok(()) => return,
            Err(error) => {
                queue.borrow_mut().in_flight = false;
                log::warn!("[Dashboard] Could not dispatch browser input: {error}");
            }
        }
    }
}

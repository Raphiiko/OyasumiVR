use crate::native_ui::{
    notice::{self, NoticeCopy},
    renderer::Renderer,
    NativeUi,
};
use raphii_openvr_rs::raw;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{channel, Receiver, Sender},
    Arc, Mutex,
};
use std::thread::JoinHandle;

enum Command {
    Move(f32, f32),
    Button(bool),
    Leave,
    Render(NoticeCopy),
}

/// Frames drawn after input, so imgui applies each queued event and the hover state settles.
const REDRAWS_AFTER_INPUT: u8 = 3;

/// State the surface thread reports back to the OpenVR task.
#[derive(Default)]
struct Shared {
    /// Set while a render command is queued or running; the OpenVR task skips frames meanwhile.
    busy: AtomicBool,
    clicked: AtomicBool,
    error: Mutex<Option<String>>,
}

/// Draws the notice on its own thread, because an imgui context and a GPU context stay on one thread.
/// Dropping it waits until the thread has released the overlay texture and its imgui context.
pub struct NoticeSurface {
    pub language: String,
    commands: Sender<Command>,
    thread: Option<JoinHandle<()>>,
    shared: Arc<Shared>,
    /// Frames still to draw; input and creation set it, each queued frame lowers it.
    redraws: u8,
}

impl NoticeSurface {
    pub fn new(
        width: u32,
        height: u32,
        language: &str,
        table: raw::VR_IVROverlay_FnTable,
        overlay: u64,
    ) -> Result<Self, String> {
        let (commands, receiver) = channel();
        let shared = Arc::new(Shared::default());
        let thread_shared = shared.clone();
        let thread_language = language.to_string();
        let thread = std::thread::Builder::new()
            .name("dashboard-notice".into())
            .spawn(move || {
                let result = run(
                    width,
                    height,
                    &thread_language,
                    table,
                    overlay,
                    receiver,
                    &thread_shared,
                );
                if let Err(error) = result {
                    *thread_shared.error.lock().unwrap() = Some(error);
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(Self {
            language: language.to_string(),
            commands,
            thread: Some(thread),
            shared,
            redraws: REDRAWS_AFTER_INPUT,
        })
    }

    /// `x` and `y` are surface pixels from the top left.
    pub fn pointer_move(&mut self, x: f32, y: f32) {
        self.send(Command::Move(x, y));
    }

    pub fn pointer_button(&mut self, down: bool) {
        self.send(Command::Button(down));
    }

    pub fn pointer_leave(&mut self) {
        self.send(Command::Leave);
    }

    fn send(&mut self, command: Command) {
        let _ = self.commands.send(command);
        self.redraws = REDRAWS_AFTER_INPUT;
    }

    /// Queues a frame when input is waiting and no frame is drawing. Returns true once the button was clicked.
    pub fn render(&mut self, copy: &NoticeCopy) -> Result<bool, String> {
        if let Some(error) = self.shared.error.lock().unwrap().take() {
            return Err(error);
        }
        if self.redraws > 0 && !self.shared.busy.swap(true, Ordering::AcqRel) {
            let _ = self.commands.send(Command::Render(copy.clone()));
            self.redraws -= 1;
        }
        Ok(self.shared.clicked.swap(false, Ordering::AcqRel))
    }
}

impl Drop for NoticeSurface {
    fn drop(&mut self) {
        // disconnect the channel, so the thread leaves its loop
        drop(std::mem::replace(&mut self.commands, channel().0));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(
    width: u32,
    height: u32,
    language: &str,
    table: raw::VR_IVROverlay_FnTable,
    overlay: u64,
    commands: Receiver<Command>,
    shared: &Shared,
) -> Result<(), String> {
    let mut ui = NativeUi::new(width, height, language)?;
    let mut renderer = Renderer::new(&mut ui, width, height)?;
    let result = serve(&mut ui, &mut renderer, &table, overlay, commands, shared);

    // SteamVR may still read the last submitted image, so release it before the device goes
    if let Some(clear) = table.ClearOverlayTexture {
        unsafe { clear(overlay) };
    }
    renderer.shutdown(&mut ui);
    result
}

fn serve(
    ui: &mut NativeUi,
    renderer: &mut Renderer,
    table: &raw::VR_IVROverlay_FnTable,
    overlay: u64,
    commands: Receiver<Command>,
    shared: &Shared,
) -> Result<(), String> {
    while let Ok(command) = commands.recv() {
        match command {
            Command::Move(x, y) => ui.pointer_move(x, y),
            Command::Button(down) => ui.pointer_button(down),
            Command::Leave => ui.pointer_leave(),
            Command::Render(copy) => {
                let clicked = renderer.render(ui, |frame| notice::draw(frame, &copy))?;
                renderer.submit(table, overlay)?;
                if clicked {
                    shared.clicked.store(true, Ordering::Release);
                }
                shared.busy.store(false, Ordering::Release);
            }
        }
    }
    Ok(())
}

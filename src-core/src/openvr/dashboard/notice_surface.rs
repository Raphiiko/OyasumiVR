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

enum Command {
    Move(f32, f32),
    Button(bool),
    Leave,
    Render(NoticeCopy),
}

/// State the surface thread reports back to the OpenVR task.
#[derive(Default)]
struct Shared {
    /// Set while a render command is queued or running; the OpenVR task skips frames meanwhile.
    busy: AtomicBool,
    clicked: AtomicBool,
    error: Mutex<Option<String>>,
}

/// Draws the notice on its own thread, because an imgui context and a GPU context stay on one thread.
/// Dropping it stops the thread.
pub struct NoticeSurface {
    pub language: String,
    commands: Sender<Command>,
    shared: Arc<Shared>,
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
        std::thread::Builder::new()
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
            shared,
        })
    }

    /// `x` and `y` are surface pixels from the top left.
    pub fn pointer_move(&self, x: f32, y: f32) {
        let _ = self.commands.send(Command::Move(x, y));
    }

    pub fn pointer_button(&self, down: bool) {
        let _ = self.commands.send(Command::Button(down));
    }

    pub fn pointer_leave(&self) {
        let _ = self.commands.send(Command::Leave);
    }

    /// Queues a frame unless one is still drawing. Returns true once the button was clicked.
    pub fn render(&self, copy: &NoticeCopy) -> Result<bool, String> {
        if let Some(error) = self.shared.error.lock().unwrap().take() {
            return Err(error);
        }
        if !self.shared.busy.swap(true, Ordering::AcqRel) {
            let _ = self.commands.send(Command::Render(copy.clone()));
        }
        Ok(self.shared.clicked.swap(false, Ordering::AcqRel))
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
    let mut ui = NativeUi::new(width, height, language);
    let mut renderer = Renderer::new(&mut ui, width, height)?;
    while let Ok(command) = commands.recv() {
        match command {
            Command::Move(x, y) => ui.pointer_move(x, y),
            Command::Button(down) => ui.pointer_button(down),
            Command::Leave => ui.pointer_leave(),
            Command::Render(copy) => {
                let clicked = renderer.render(&mut ui, |frame| notice::draw(frame, &copy))?;
                renderer.submit(&table, overlay)?;
                if clicked {
                    shared.clicked.store(true, Ordering::Release);
                }
                shared.busy.store(false, Ordering::Release);
            }
        }
    }
    Ok(())
}

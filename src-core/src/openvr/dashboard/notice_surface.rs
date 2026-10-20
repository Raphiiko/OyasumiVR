use crate::native_ui::{
    notice::{self, NoticeCopy},
    renderer::Renderer,
    NativeUi,
};
use raphii_openvr_rs::raw;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{channel, Receiver, Sender},
    Mutex, OnceLock,
};

enum Command {
    Move(f32, f32),
    Button(bool),
    Leave,
    Render {
        copy: NoticeCopy,
        table: Box<raw::VR_IVROverlay_FnTable>,
        overlay: u64,
    },
    /// Answered once every earlier command has run, so no frame reaches the overlay afterwards.
    Close(Sender<()>),
}

/// Frames drawn after input, so imgui applies each queued event and the hover state settles.
const REDRAWS_AFTER_INPUT: u8 = 3;

/// State the worker reports back to the OpenVR task.
struct Shared {
    /// Set while a render command is queued or running; the OpenVR task skips frames meanwhile.
    busy: AtomicBool,
    clicked: AtomicBool,
    error: Mutex<Option<String>>,
}

static SHARED: Shared = Shared {
    busy: AtomicBool::new(false),
    clicked: AtomicBool::new(false),
    error: Mutex::new(None),
};

/// The worker that draws every notice. It starts with the first notice and lives until the
/// process exits, because its Vulkan device must outlive OpenVR.
static WORKER: OnceLock<Result<Sender<Command>, String>> = OnceLock::new();

/// Shows the notice on an overlay, drawn on the worker thread, because an imgui context and
/// its GPU objects stay on one thread. Dropping it waits until the overlay gets no more frames.
pub struct NoticeSurface {
    commands: Sender<Command>,
    table: raw::VR_IVROverlay_FnTable,
    overlay: u64,
    /// Last pointer position in whole pixels, or None while the pointer is off the surface.
    pointer: Option<(f32, f32)>,
    /// Copy the frames show, so a language change draws again without input.
    copy: Option<NoticeCopy>,
    /// Frames still to draw; input, creation and new copy set it, each queued frame lowers it.
    redraws: u8,
}

impl NoticeSurface {
    pub fn new(
        width: u32,
        height: u32,
        table: raw::VR_IVROverlay_FnTable,
        overlay: u64,
    ) -> Result<Self, String> {
        let commands = WORKER.get_or_init(|| start(width, height)).clone()?;
        SHARED.clicked.store(false, Ordering::Release);
        SHARED.error.lock().unwrap().take();
        Ok(Self {
            commands,
            table,
            overlay,
            pointer: None,
            copy: None,
            redraws: REDRAWS_AFTER_INPUT,
        })
    }

    /// `x` and `y` are surface pixels from the top left.
    pub fn pointer_move(&mut self, x: f32, y: f32) {
        // SteamVR repeats a resting pointer's position with tiny float jitter, so compare whole pixels
        let pixel = (x.round(), y.round());
        if self.pointer.replace(pixel) != Some(pixel) {
            self.send(Command::Move(x, y));
        }
    }

    pub fn pointer_button(&mut self, down: bool) {
        self.send(Command::Button(down));
    }

    pub fn pointer_leave(&mut self) {
        if self.pointer.take().is_some() {
            self.send(Command::Leave);
        }
    }

    fn send(&mut self, command: Command) {
        let _ = self.commands.send(command);
        self.redraws = REDRAWS_AFTER_INPUT;
    }

    /// Queues a frame when input or new copy is waiting and no frame is drawing. Returns true once the button was clicked.
    pub fn render(&mut self, copy: &NoticeCopy) -> Result<bool, String> {
        if let Some(error) = SHARED.error.lock().unwrap().take() {
            return Err(error);
        }
        if self.copy.as_ref() != Some(copy) {
            self.copy = Some(copy.clone());
            self.redraws = REDRAWS_AFTER_INPUT;
        }
        if self.redraws > 0 && !SHARED.busy.swap(true, Ordering::AcqRel) {
            let _ = self.commands.send(Command::Render {
                copy: copy.clone(),
                table: Box::new(self.table),
                overlay: self.overlay,
            });
            self.redraws -= 1;
        }
        Ok(SHARED.clicked.swap(false, Ordering::AcqRel))
    }
}

impl Drop for NoticeSurface {
    fn drop(&mut self) {
        let (done, closed) = channel();
        if self.commands.send(Command::Close(done)).is_ok() {
            let _ = closed.recv();
        }
    }
}

/// Starts the worker and waits until its Vulkan device exists.
fn start(width: u32, height: u32) -> Result<Sender<Command>, String> {
    let (commands, receiver) = channel();
    let (ready, started) = channel();
    std::thread::Builder::new()
        .name("dashboard-notice".into())
        .spawn(move || match Renderer::new(width, height) {
            Ok(renderer) => {
                let _ = ready.send(Ok(()));
                serve(renderer, width, height, receiver);
            }
            Err(error) => {
                let _ = ready.send(Err(error));
            }
        })
        .map_err(|error| error.to_string())?;
    started.recv().map_err(|error| error.to_string())??;
    Ok(commands)
}

fn serve(mut renderer: Renderer, width: u32, height: u32, commands: Receiver<Command>) {
    let mut ui: Option<(String, NativeUi)> = None;
    while let Ok(command) = commands.recv() {
        let pointer = ui.as_mut().map(|(_, ui)| ui);
        match command {
            Command::Move(x, y) => {
                if let Some(ui) = pointer {
                    ui.pointer_move(x, y);
                }
            }
            Command::Button(down) => {
                if let Some(ui) = pointer {
                    ui.pointer_button(down);
                }
            }
            Command::Leave => {
                if let Some(ui) = pointer {
                    ui.pointer_leave();
                }
            }
            Command::Close(done) => {
                // the next notice starts with no pointer and no pressed button
                if let Some(ui) = pointer {
                    ui.pointer_button(false);
                    ui.pointer_leave();
                }
                let _ = done.send(());
            }
            Command::Render {
                copy,
                table,
                overlay,
            } => {
                let result = render(
                    &mut renderer,
                    &mut ui,
                    width,
                    height,
                    &copy,
                    &table,
                    overlay,
                );
                match result {
                    Ok(true) => SHARED.clicked.store(true, Ordering::Release),
                    Ok(false) => {}
                    Err(error) => *SHARED.error.lock().unwrap() = Some(error),
                }
                SHARED.busy.store(false, Ordering::Release);
            }
        }
    }
}

/// Draws and submits one frame, first rebuilding the imgui context when the language, and with it the font, changed.
fn render(
    renderer: &mut Renderer,
    ui: &mut Option<(String, NativeUi)>,
    width: u32,
    height: u32,
    copy: &NoticeCopy,
    table: &raw::VR_IVROverlay_FnTable,
    overlay: u64,
) -> Result<bool, String> {
    // only one imgui context may exist per thread, so the old one goes first
    if ui
        .as_ref()
        .is_some_and(|(language, _)| *language != copy.language)
    {
        let (_, mut old) = ui.take().unwrap();
        renderer.detach(&mut old);
    }
    if ui.is_none() {
        let mut fresh = NativeUi::new(width, height, &copy.language)?;
        renderer.attach(&mut fresh)?;
        *ui = Some((copy.language.clone(), fresh));
    }

    let (_, ui) = ui.as_mut().unwrap();
    let clicked = renderer.render(ui, |frame| notice::draw(frame, copy))?;
    renderer.submit(table, overlay)?;
    Ok(clicked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(language: &str) -> NoticeCopy {
        NoticeCopy {
            language: language.into(),
            title: format!("{language} title"),
            message: String::new(),
            button: String::new(),
        }
    }

    /// Renders once per finished frame and counts the frames queued.
    fn frames(
        surface: &mut NoticeSurface,
        commands: &Receiver<Command>,
        copy: &NoticeCopy,
    ) -> usize {
        for _ in 0..10 {
            SHARED.busy.store(false, Ordering::Release);
            surface.render(copy).unwrap();
        }
        commands.try_iter().count()
    }

    #[test]
    fn a_language_change_draws_again_without_input() {
        let (sender, receiver) = channel();
        let mut surface = NoticeSurface {
            commands: sender,
            table: unsafe { std::mem::zeroed() },
            overlay: 0,
            pointer: None,
            copy: None,
            redraws: REDRAWS_AFTER_INPUT,
        };
        // dropped before the surface, so its drop does not wait for a worker
        let commands = receiver;
        let english = copy("en");

        assert_eq!(frames(&mut surface, &commands, &english), 3);
        assert_eq!(frames(&mut surface, &commands, &english), 0);
        assert_eq!(frames(&mut surface, &commands, &copy("ja")), 3);
    }
}

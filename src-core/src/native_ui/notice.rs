use super::MUTED;
use dear_imgui_rs::{Condition, Ui, WindowFlags};
use std::sync::{LazyLock, Mutex};

/// Translated copy for the notice, pushed by the UI whenever its language changes.
#[derive(Clone)]
pub struct NoticeCopy {
    pub language: String,
    pub title: String,
    pub message: String,
    pub button: String,
}

pub static NOTICE_COPY: LazyLock<Mutex<NoticeCopy>> = LazyLock::new(|| {
    Mutex::new(NoticeCopy {
        language: "en".into(),
        title: "OyasumiVR is open on your desktop".into(),
        message:
            "It can only show in one place at a time. Show it here to hide the desktop window."
                .into(),
        button: "Show it here".into(),
    })
});

const TITLE_SIZE: f32 = 64.0;
const MESSAGE_SIZE: f32 = 38.0;
const BUTTON_SIZE: [f32; 2] = [440.0, 110.0];

/// Draws the notice over the whole surface. Returns true on the frame its button is clicked.
pub fn draw(ui: &Ui, copy: &NoticeCopy) -> bool {
    let [width, height] = ui.io().display_size();
    let mut clicked = false;
    ui.window("notice")
        .position([0.0, 0.0], Condition::Always)
        .size([width, height], Condition::Always)
        .flags(WindowFlags::NO_DECORATION | WindowFlags::NO_MOVE | WindowFlags::NO_SAVED_SETTINGS)
        .build(|| {
            // title, centred above the middle
            ui.with_font_and_size(None, TITLE_SIZE, || {
                centred_text(ui, &copy.title, width, height / 2.0 - 140.0, None);
            });

            // explanation below the title
            ui.with_font_and_size(None, MESSAGE_SIZE, || {
                centred_text(ui, &copy.message, width, height / 2.0 - 40.0, Some(MUTED));
            });

            // button that takes the UI back from the desktop
            ui.with_font_and_size(None, 40.0, || {
                ui.set_cursor_pos([(width - BUTTON_SIZE[0]) / 2.0, height / 2.0 + 80.0]);
                clicked = ui.button_with_size(&copy.button, BUTTON_SIZE);
            });
        });
    clicked
}

fn centred_text(ui: &Ui, text: &str, width: f32, y: f32, color: Option<[f32; 4]>) {
    let [text_width, _] = ui.calc_text_size(text);
    ui.set_cursor_pos([((width - text_width) / 2.0).max(40.0), y]);
    match color {
        Some(color) => ui.text_colored(color, text),
        None => ui.text(text),
    }
}

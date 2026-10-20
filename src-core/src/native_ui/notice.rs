use super::MUTED;
use crate::i18n;
use dear_imgui_rs::{Condition, Ui, WindowFlags};

/// The notice text in the UI's current language.
#[derive(Clone, PartialEq)]
pub struct NoticeCopy {
    pub language: String,
    pub title: String,
    pub message: String,
    pub button: String,
}

impl NoticeCopy {
    pub fn current() -> Self {
        Self {
            language: i18n::language(),
            title: i18n::translate("steamvr-dashboard.desktopNotice.title"),
            message: i18n::translate("steamvr-dashboard.desktopNotice.message"),
            button: i18n::translate("steamvr-dashboard.desktopNotice.button"),
        }
    }
}

const TITLE_SIZE: f32 = 76.0;
const MESSAGE_SIZE: f32 = 44.0;
const BUTTON_TEXT_SIZE: f32 = 48.0;
const BUTTON_SIZE: [f32; 2] = [560.0, 130.0];
const MARGIN: f32 = 120.0;
const GAP: f32 = 40.0;

/// Draws the notice over the whole surface. Returns true on the frame its button is clicked.
pub fn draw(ui: &Ui, copy: &NoticeCopy) -> bool {
    let [width, height] = ui.io().display_size();
    let mut clicked = false;
    ui.window("notice")
        .position([0.0, 0.0], Condition::Always)
        .size([width, height], Condition::Always)
        .flags(WindowFlags::NO_DECORATION | WindowFlags::NO_MOVE | WindowFlags::NO_SAVED_SETTINGS)
        .build(|| {
            // wrap the text, then centre the title, message, and button as one stack
            let max_width = width - 2.0 * MARGIN;
            let title = Block::new(ui, &copy.title, TITLE_SIZE, max_width);
            let message = Block::new(ui, &copy.message, MESSAGE_SIZE, max_width);
            let stack = title.height() + GAP + message.height() + 2.0 * GAP + BUTTON_SIZE[1];
            let mut y = (height - stack) / 2.0;

            title.draw(ui, width, y, None);
            y += title.height() + GAP;
            message.draw(ui, width, y, Some(MUTED));
            y += message.height() + 2.0 * GAP;

            // button that takes the UI back from the desktop
            ui.with_font_and_size(None, BUTTON_TEXT_SIZE, || {
                ui.set_cursor_pos([(width - BUTTON_SIZE[0]) / 2.0, y]);
                clicked = ui.button_with_size(&copy.button, BUTTON_SIZE);
            });
        });
    clicked
}

/// Text wrapped to a width at one font size, drawn centred line by line.
struct Block {
    size: f32,
    lines: Vec<String>,
    line_height: f32,
}

impl Block {
    fn new(ui: &Ui, text: &str, size: f32, max_width: f32) -> Self {
        ui.with_font_and_size(None, size, || Self {
            size,
            lines: wrap(text, max_width, |part| ui.calc_text_size(part)[0]),
            line_height: ui.text_line_height_with_spacing(),
        })
    }

    fn height(&self) -> f32 {
        self.lines.len() as f32 * self.line_height
    }

    fn draw(&self, ui: &Ui, width: f32, y: f32, color: Option<[f32; 4]>) {
        ui.with_font_and_size(None, self.size, || {
            for (index, line) in self.lines.iter().enumerate() {
                let [line_width, _] = ui.calc_text_size(line);
                ui.set_cursor_pos([
                    (width - line_width) / 2.0,
                    y + index as f32 * self.line_height,
                ]);
                match color {
                    Some(color) => ui.text_colored(color, line),
                    None => ui.text(line),
                }
            }
        });
    }
}

/// Breaks `text` into lines no wider than `max_width`: at spaces where it can, between
/// characters where a run has no spaces, as in Japanese and Chinese.
fn wrap(text: &str, max_width: f32, measure: impl Fn(&str) -> f32) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for character in text.chars() {
        line.push(character);
        if measure(&line) <= max_width {
            continue;
        }
        let overflow = line.len() - character.len_utf8();
        let split = match line[..overflow].rfind(' ') {
            _ if character == ' ' => overflow,
            Some(space) if space > 0 => space,
            _ => overflow,
        };
        let rest = line.split_off(split);
        lines.push(std::mem::take(&mut line));
        line = rest.trim_start().to_string();
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::wrap;

    fn width(text: &str) -> f32 {
        text.chars().count() as f32
    }

    #[test]
    fn wraps_at_spaces_and_inside_runs_without_spaces() {
        assert_eq!(wrap("one two three", 7.0, width), ["one two", "three"]);
        assert_eq!(wrap("short", 7.0, width), ["short"]);
        assert_eq!(
            wrap("あいうえおかきくけ", 4.0, width),
            ["あいうえ", "おかきく", "け"]
        );
    }
}

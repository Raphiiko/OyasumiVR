//! Screens drawn with Dear ImGui, for surfaces that cannot host a web view.
//! The screens and the context setup are platform independent; a GPU backend renders them.

pub mod notice;
pub mod renderer;

use dear_imgui_rs::{
    Context, FontConfig, FontSource, MouseButton, StbTrueTypeFontData, StyleColor,
};

const BACKGROUND: [f32; 4] = rgb(0x15, 0x15, 0x15);
const TEXT: [f32; 4] = rgb(0xf8, 0xf8, 0xf2);
pub const MUTED: [f32; 4] = rgb(0xb4, 0xb4, 0xb4);
const PRIMARY: [f32; 4] = rgb(0xff, 0x53, 0x70);
const PRIMARY_HOVER: [f32; 4] = rgb(0xff, 0x6e, 0x86);
const PRIMARY_ACTIVE: [f32; 4] = rgb(0xe0, 0x45, 0x60);

const fn rgb(r: u8, g: u8, b: u8) -> [f32; 4] {
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0]
}

/// An imgui context sized for one offscreen surface, styled like the OyasumiVR UI.
pub struct NativeUi {
    pub context: Context,
}

impl NativeUi {
    /// `language` is an OyasumiVR locale code, such as `ja`; it picks the fallback font for its script.
    pub fn new(width: u32, height: u32, language: &str) -> Self {
        let mut context = Context::create();
        let _ = context.set_ini_filename(None::<String>);
        context
            .io_mut()
            .set_display_size([width as f32, height as f32]);
        load_fonts(&context, language);
        let style = context.style_mut();
        style.set_window_padding([0.0, 0.0]);
        style.set_window_border_size(0.0);
        style.set_frame_rounding(12.0);
        style.set_color(StyleColor::WindowBg, BACKGROUND);
        style.set_color(StyleColor::Text, TEXT);
        style.set_color(StyleColor::Button, PRIMARY);
        style.set_color(StyleColor::ButtonHovered, PRIMARY_HOVER);
        style.set_color(StyleColor::ButtonActive, PRIMARY_ACTIVE);
        Self { context }
    }

    /// `x` and `y` are surface pixels from the top left.
    pub fn pointer_move(&mut self, x: f32, y: f32) {
        self.context.io_mut().add_mouse_pos_event([x, y]);
    }

    pub fn pointer_button(&mut self, down: bool) {
        self.context
            .io_mut()
            .add_mouse_button_event(MouseButton::Left, down);
    }

    pub fn pointer_leave(&mut self) {
        self.context
            .io_mut()
            .add_mouse_pos_event([-f32::MAX, -f32::MAX]);
    }
}

/// Loads a UI font plus a fallback for scripts it lacks, or imgui's built-in font when neither exists.
fn load_fonts(context: &Context, language: &str) {
    // ponytail: Windows font paths only; add fontconfig lookups when a Linux surface needs this
    let mut sources = Vec::new();
    for path in [
        Some("C:\\Windows\\Fonts\\seguisb.ttf"),
        fallback_font(language),
    ]
    .into_iter()
    .flatten()
    {
        match StbTrueTypeFontData::from_file(path) {
            Ok(data) => sources.push(
                FontSource::stb_truetype(data)
                    .with_config(FontConfig::new().merge_mode(!sources.is_empty())),
            ),
            Err(error) => log::warn!("[NativeUi] Could not load font {path}: {error}"),
        }
    }
    if sources.is_empty() {
        sources.push(FontSource::default_vector());
    }
    context.font_atlas().add_font(&sources);
}

fn fallback_font(language: &str) -> Option<&'static str> {
    match language {
        "ja" => Some("C:\\Windows\\Fonts\\YuGothM.ttc"),
        "ko" => Some("C:\\Windows\\Fonts\\malgun.ttf"),
        "cn" => Some("C:\\Windows\\Fonts\\msyh.ttc"),
        "tw" => Some("C:\\Windows\\Fonts\\msjh.ttc"),
        "th" => Some("C:\\Windows\\Fonts\\LeelawUI.ttf"),
        _ => None,
    }
}

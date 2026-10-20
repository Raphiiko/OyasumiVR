//! Screens drawn with Dear ImGui, for surfaces that cannot host a web view.
//! The screens and the context setup are platform independent; a GPU backend renders them.

pub mod notice;
pub mod renderer;
mod steamvr;

use std::path::Path;

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
    /// `language` is an OyasumiVR locale code, such as `ja`; it picks the fonts for its script.
    pub fn new(width: u32, height: u32, language: &str) -> Result<Self, String> {
        let mut context = Context::try_create().map_err(|error| error.to_string())?;
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
        Ok(Self { context })
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

/// Copied there by `scripts/pre-build.js`; relative to the cwd, which `main.rs` sets to the exe directory.
const FONT_DIR: &str = "resources/fonts";

/// Poppins SemiBold, which the OyasumiVR UI loads for every language.
const UI_FONTS: [&str; 2] = [
    "poppins-latin-600-normal.woff2",
    "poppins-latin-ext-600-normal.woff2",
];

/// Loads the fonts the OyasumiVR UI uses for `language`, or imgui's built-in font when none load.
fn load_fonts(context: &Context, language: &str) {
    // bundled fonts first, so their glyphs win over the system fallback for the same character
    let bundled = UI_FONTS
        .into_iter()
        .chain(cjk_font(language))
        .map(|name| (name, read_woff2(&Path::new(FONT_DIR).join(name))));
    let system = system_fonts(language)
        .into_iter()
        .map(|path| (path, read_ttf(Path::new(path))));
    let fonts: Vec<StbTrueTypeFontData> = bundled
        .chain(system)
        .filter_map(|(name, font)| {
            font.inspect_err(|error| log::warn!("[NativeUi] Could not load font {name}: {error}"))
                .ok()
        })
        .collect();

    let mut sources: Vec<FontSource> = fonts
        .into_iter()
        .enumerate()
        .map(|(index, font)| {
            FontSource::stb_truetype(font).with_config(FontConfig::new().merge_mode(index > 0))
        })
        .collect();
    if sources.is_empty() {
        sources.push(FontSource::default_vector());
    }
    context.font_atlas().add_font(&sources);
}

/// The Noto Sans font the OyasumiVR UI loads for `language`, which also picks the Han glyph shapes.
fn cjk_font(language: &str) -> Option<&'static str> {
    match language {
        "ja" => Some("noto-sans-jp-japanese-600-normal.woff2"),
        "ko" => Some("noto-sans-kr-korean-600-normal.woff2"),
        "cn" => Some("noto-sans-sc-chinese-simplified-600-normal.woff2"),
        "tw" => Some("noto-sans-tc-chinese-traditional-600-normal.woff2"),
        _ => None,
    }
}

/// The fonts a web view on Windows falls back to for scripts the bundled fonts lack, such as Cyrillic and Thai.
fn system_fonts(language: &str) -> Vec<&'static str> {
    let mut fonts = vec![r"C:\Windows\Fonts\seguisb.ttf"];
    if language == "th" {
        fonts.push(r"C:\Windows\Fonts\LeelawUI.ttf");
    }
    fonts
}

fn read_woff2(path: &Path) -> Result<StbTrueTypeFontData, String> {
    let woff2 = std::fs::read(path).map_err(|error| error.to_string())?;
    let ttf = woff2_patched::convert_woff2_to_ttf(&mut woff2.as_slice())
        .map_err(|error| error.to_string())?;
    StbTrueTypeFontData::from_bytes(ttf).map_err(|error| error.to_string())
}

fn read_ttf(path: &Path) -> Result<StbTrueTypeFontData, String> {
    StbTrueTypeFontData::from_file(path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires the @fontsource packages that npm ci installs"]
    fn every_bundled_font_loads_into_an_atlas() {
        let names = UI_FONTS
            .into_iter()
            .chain(["ja", "ko", "cn", "tw"].into_iter().filter_map(cjk_font));
        let context = Context::create();
        for name in names {
            // the fontsource packages the build copies the fonts from
            let package = [
                "poppins",
                "noto-sans-jp",
                "noto-sans-kr",
                "noto-sans-sc",
                "noto-sans-tc",
            ]
            .into_iter()
            .find(|package| name.starts_with(package))
            .unwrap();
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../node_modules/@fontsource")
                .join(package)
                .join("files")
                .join(name);
            let font = read_woff2(&path).unwrap_or_else(|error| panic!("{name}: {error}"));
            context
                .font_atlas()
                .add_font(&[FontSource::stb_truetype(font)]);
        }
    }
}

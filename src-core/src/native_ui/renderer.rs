use super::NativeUi;
use dear_imgui_rs::Ui;
use raphii_openvr_rs::raw;

/// Renders imgui frames offscreen on the GPU and submits them to an OpenVR overlay.
/// Lives on one thread for its whole life, together with the `NativeUi` it renders.
pub struct Renderer;

impl Renderer {
    pub fn new(_ui: &mut NativeUi, _width: u32, _height: u32) -> Result<Self, String> {
        Err("No GPU backend for native UI".into())
    }

    /// Builds one frame with `draw`, renders it, and returns what `draw` returned.
    pub fn render<R>(
        &mut self,
        _ui: &mut NativeUi,
        _draw: impl FnOnce(&Ui) -> R,
    ) -> Result<R, String> {
        Err("No GPU backend for native UI".into())
    }

    /// Hands the last rendered frame to `overlay`.
    pub fn submit(&self, _table: &raw::VR_IVROverlay_FnTable, _overlay: u64) -> Result<(), String> {
        Err("No GPU backend for native UI".into())
    }
}

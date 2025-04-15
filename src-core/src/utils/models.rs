#[derive(strum_macros::Display)]
pub enum CoreMode {
    Dev,
    Release,
}

#[derive(strum_macros::Display)]
pub enum OverlaySidecarMode {
    Dev,
    Release,
}

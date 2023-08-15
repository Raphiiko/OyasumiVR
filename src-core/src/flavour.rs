#[derive(PartialEq)]
pub enum BuildFlavour {
    Dev,
    Standalone,
    Steam,
}

pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::Dev;

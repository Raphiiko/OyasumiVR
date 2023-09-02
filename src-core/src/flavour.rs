#[derive(PartialEq)]
pub enum BuildFlavour {
    Dev,
    Standalone,
    Steam,
    SteamCn,
}

pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::Dev;

use serde::Serialize;

#[derive(PartialEq, Serialize)]
pub enum BuildFlavour {
    Dev,
    Standalone,
    Steam,
    SteamCn,
}

pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::Dev;

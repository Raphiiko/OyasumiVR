# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0]

### Added

- New feature for automatically accepting invite requests while on orange/green status, optionally based on a white- or blacklist.
- Korean language support, thanks to [@soumt-r](https://github.com/soumt-r).

### Changed

- Made sleeping position animation automations automatically trigger when the automation is enabled.
- Prevent Oyasumi from being opened twice and instead focus the window for the instance already running.

## [1.2.2]

### Fixed

- Fixed issue where the main window would load before the app was ready, due to a bug in a new version of the `tao` crate.

## [1.2.1]

### Fixed

- Updated Tauri dependencies to new 1.2 release.
- Properly send user agent to VRChat API when connecting the websocket.
- Updated various dependencies to their latest version.

## [1.2.0]

### Added

- Status automations for automatically changing your VRChat status based on the amount of players in your world.
- VRChat login for features that require accessing the VRChat API. (e.g. Status automations)
- Possibility for specific options to be triggered over OSC (and thus using VRChat avatar parameters):
  - Sleep Mode
  - Sleeping Animation Automations
  - Status Automations
  - Turning off controllers
  - Turning off trackers
  - Turning off trackers & controllers
- Status bar for showing the current sleep mode and logged-in VRChat account, as well as the status of that account.
- Better logging

### Fixed

- Setting migrators properly resetting to defaults when detecting configs from future versions.

## [1.1.0]

### Added

- Sleeping animation automation preset for [GoGo Loco v1.7.1 by franada](https://booth.pm/en/items/3290806).
- Sleeping animation automation (workaround) preset for [GoGo Loco v1.6.2 - v1.7.0 by franada](https://booth.pm/en/items/3290806).

### Changed

- Marked the preset for [ごろ寝システム (Sleep System) by みんみんみーん](https://booth.pm/ko/items/2886739) to also support v2.3 and the new EX version.
- Changed presets to support multiple info links (to show both んみんみーん's EX and non-EX version)

### Fixed

- Fixed side sleeping poses being detected too early in some positions.

## [1.0.0]

### Added

- Sleeping animation automations for automatically changing the sleeping animation of your avatar based on your sleeping position.
  - Preset for [ごろ寝システム (Sleep System) v2.2 by みんみんみーん](https://booth.pm/ko/items/2886739).
- Setting to start Oyasumi with administrator privileges by default
- Editor for writing OSC scripts
- In-app updater & changelog
- Japanese language support (日本語対応)
- Language selection modal on first startup
- Prepackaged Japanese font
- Anonymous telemetry (Only sends the application version and language)
- App icon

### Changed

- Navigation item for GPU Automations to show an error icon when the feature is enabled, but no administrator privileges were detected.
- Switched to Fontsource for the application font, to remove the dependency on Google for providing fonts at runtime.
- Added own updater UI to replace the default Tauri update dialog.

### Fixed

- The main window can now be interacted with through the SteamVR overlay or other overlays like XSOverlay, when given administrator privileges.
- Fixed turning off devices sometimes triggering the "disabling sleep mode when a device is turned on" automation.
- Fixed Oyasumi freezing when SteamVR is stopped while it is still running.

## [0.3.0]

### Added

- Global sleep mode to more clearly separate triggers and actions for easier future expansion.
- Version migrations for app settings and automation configurations, to aid preservation of configuration during future updates.
- GPU Automations for automatically adjusting the power limits of NVIDIA GPUs

### Changed

- Turned most battery automations into sleep detection triggers.
- Restructured automation configs. (**this update will reset your settings**)
- Changed splash screen to a new design.

## [0.2.1]

### Added

- Missing Dutch translations

## [0.2.0]

### Added

- Debug option for loading translation files from disk
- Repository: Translation template downloader

## [0.1.1]

### Fixed

- Release workflow

## [0.1.0]

### Added

- Initial Release

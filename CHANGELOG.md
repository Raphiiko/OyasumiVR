# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sleeping animation automations for automatically changing the sleeping animation of your avatar based on your sleeping position.
  - Preset for [ごろ寝システム (Sleep System) v2.2 by んみんみーん](https://booth.pm/ko/items/2886739).
  - Preset for [GoGo Loco v1.7.1 by franada](https://booth.pm/en/items/3290806).
- Setting to start Oyasumi with administrator privileges by default
- Editor for writing OSC scripts
- Prepackaged Japanese font
- App icon

### Changed

- Navigation item for GPU Automations to show an error icon when the feature is enabled, but no administrator privileges were detected.
- Switched to Fontsource for the application font, to remove the dependency on Google for providing fonts at runtime.
- Added own updater UI to replace the default Tauri update dialog. 

### Fixed

- The main window can now be interacted with through the SteamVR overlay or other overlays like XSOverlay, when given administrator privileges.

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

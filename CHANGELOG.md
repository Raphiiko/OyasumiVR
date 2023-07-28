# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Allow limiting sleep detection to certain hours of the day.

### Changed

- Added missing translations for Traditional and Simplified Chinese. (By [狐 Kon](https://github.com/XoF-eLtTiL))

## [1.8.0]

### Added

- SteamVR overlay for controlling basic OyasumiVR functionality (e.g. toggling sleep mode, toggling automations, running
  the shutdown sequence, turning off devices)
- Native OyasumiVR notifications
- Image brightness automations for all headsets
- Automations for changing Windows' Power Policy when you go to sleep and wake up.
- Notification for when an invite request is automatically accepted
- Notification for when your VRChat status is updated by the status automation
- Options for turning certain notification types on or off
- Startup check for missing (.NET) runtimes, with option for automatic installation.
- Event log entry when MSI Afterburner profiles are set.

### Changed

- Changed SteamVR-based power automations for base stations to apply when new base stations are discovered
- If the main window is minimized to the tray, it will reveal itself when the user tries to launch a second instance.
- Disabled notification sound for XSOverlay notifications
- Switched to dynamic font loading to decrease overall application size
- Switched sidecar communication from HTTP to gRPC

### Fixed

- Fixed menus for Hardware Automations and VRChat Automations not being correctly highlighted when one of their submenus
  is active
- Fixed short loss of tracking in SteamVR when launching or reloading OyasumiVR
- Fixed friend selection modal for automatic invite request acceptance becoming unusable when too many players have been
  selected
- Added workaround for VRChat's API not always returning the entire friends list
- Fixed settings migrations sometimes not merging arrays correctly, leading to unexpected behavior
- Fixed a potential issue where the sleep detector would not be able to properly trigger
- Fixed naming for VRC statuses to be more consistent
- Adapted to changes in VRChat API authentication
- Optimized CPU usage

## [1.7.3]

### Fixed

- Fixed Oyasumi not being able to start on some systems due to locked Bluetooth adapters.

## [1.7.2]

### Changed

- Updated Japanese Translations
- Updated references to the new GitHub repository, following the rebrand to OyasumiVR

## [1.7.1]

### Fixed

- Fixed enabling GPU automations crashing Oyasumi

## [1.7.0]

### Added

- Option to increase the detection window for sleep detection.
- New "Advanced" tab in the settings for advanced configuration options.
- Tools for clearing (parts of) Oyasumi's persistent data.
- Button for opening Oyasumi's log folder.
- New multilingual NSIS based installer package for new releases.
- Allow for disabling of OSC features to prevent Oyasumi from binding ports.
- Show error indicators in navigation and tabs when the OSC server cannot be started.
- System tray icon (by [neuroblack](https://github.com/neuroblack)).
- Option to close Oyasumi's window to the system tray, rather than quitting the application
  (by [neuroblack](https://github.com/neuroblack)).
- Option to start Oyasumi hidden in the system tray (by [neuroblack](https://github.com/neuroblack)).
- Power management for SteamVR base stations (Supports V2 Lighthouses only).
- Option for forcing the state of the sleep mode at launch
- Automations for turning base stations on and off with SteamVR
- Automation for turning base stations on with Oyasumi
- Automations for controlling the Chaperone fade distance (by [góngo](https://github.com/TheMrGong))
- Added shutdown sequence automations for helping with sleeping outside VR.

### Changed

- Remote images now fade in smoothly upon load.
- Language selection modal now always shows if the user has not picked a language.
- Reorganized navigation.
- Updated splash screen.
- Updated to Angular 16 & Tauri 1.3.

### Removed

- Removed experimental flag for sleep detection feature.
- Removed debug tab in the settings view.
- Removed bundling of WIX based installer packages.

### Fixed

- Stopped brightness automations from triggering when there is no headset available.
- Prevent the update service from being initialised until after language selection.

## [1.6.0]

### Added

- Display brightness automations for Valve Index.
- Automations for adjusting SteamVR's render resolution.
- Event log for displaying actions taken by Oyasumi.
- OSC Automations for sending custom OSC commands when the sleep mode changes.
- Language support for French, thanks to [neuroblack](https://github.com/neuroblack).

### Changed

- Updated layout and styling of various views to match more recent views.
- Prevent sleep detector from triggering when sleep mode was disabled less than 15 minutes ago.
- Bulk removing friends from the player list for automatic invite request accepts, now requires confirmation.
- Reorganized navigation bar to reduce clutter.
- Updated to Angular 15.

## [1.5.1]

### Fixed

- Added missing translations for Traditional and Simplified Chinese. (By [狐 Kon](https://github.com/XoF-eLtTiL))

## [1.5.0]

### Added

- [EXPERIMENTAL] Sleep detection based on the movement of the user's VR headset.
- Automation for disabling sleep mode when SteamVR has been stopped.
- Configuration options for setting the OSC hosts and ports Oyasumi interacts with.
- Support for XSOverlay and Desktop notifications.
- Notifications for when sleep mode is enabled and disabled.

### Changed

- The elevated sidecar will be launched on start if the main application is launched with administrator privileges.
- Layout of Sleep Detection pane has been updated to match recent views.
- Configuration options for sleep detection automations can now be edited while the automations are inactive.
- Removing friends from the player list for automatic invite request accepts, now requires confirmation.

### Fixed

- Various improvements to the Japanese translations (by [なき](https://twitter.com/NoYu_idea))
- Various small bugs

## [1.4.1]

### Added

- Added support for logins where VRChat sends an OTP via email for accounts without 2FA enabled.

### Fixed

- Error handling when VRChat wants users to confirm their new location via email.

## [1.4.0]

### Added

- Add automations for automatically switching MSI Afterburner profiles when the sleep mode changes.
- Allow sleep mode to be toggled from the pill in the status bar.
- Language support for Traditional and Simplified Chinese, thanks to [狐 Kon](https://github.com/XoF-eLtTiL).

### Changed

- SteamVR is no longer required for Oyasumi to run.
- SteamVR does no longer automatically start when Oyasumi is started.
- Improved error handling and error messages for non-nvidia users.
- Improved logging on elevated sidecar module.

## [1.3.1]

### Fixed

- A bug where VRChat accounts without 2FA enabled could not log in properly.
- A bug where the status bar would still show a VRChat user name after logging out.

### Changed

- Update check to run every week after application start, in case Oyasumi is left running for a long time.
- Update check to rerun every 10 minutes until at least one check has succeeded, in case Oyasumi is started while
  offline.

## [1.3.0]

### Added

- New feature for automatically accepting invite requests while on orange/green status, optionally based on a white- or
  blacklist.
- Korean language support, thanks to [@soumt-r](https://github.com/soumt-r).

### Changed

- Made sleeping position animation automations automatically trigger when the automation is enabled.
- Prevent Oyasumi from being opened twice and instead focus the window for the instance already running.

## [1.2.2]

### Fixed

- Fixed issue where the main window would load before the app was ready, due to a bug in a new version of the `tao`
  crate.

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
- Sleeping animation automation (workaround) preset
  for [GoGo Loco v1.6.2 - v1.7.0 by franada](https://booth.pm/en/items/3290806).

### Changed

- Marked the preset for [ごろ寝システム (Sleep System) by みんみんみーん](https://booth.pm/ko/items/2886739) to also support v2.3 and
  the new EX version.
- Changed presets to support multiple info links (to show both んみんみーん's EX and non-EX version)

### Fixed

- Fixed side sleeping poses being detected too early in some positions.

## [1.0.0]

### Added

- Sleeping animation automations for automatically changing the sleeping animation of your avatar based on your sleeping
  position.
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

- Navigation item for GPU Automations to show an error icon when the feature is enabled, but no administrator privileges
  were detected.
- Switched to Fontsource for the application font, to remove the dependency on Google for providing fonts at runtime.
- Added own updater UI to replace the default Tauri update dialog.

### Fixed

- The main window can now be interacted with through the SteamVR overlay or other overlays like XSOverlay, when given
  administrator privileges.
- Fixed turning off devices sometimes triggering the "disabling sleep mode when a device is turned on" automation.
- Fixed Oyasumi freezing when SteamVR is stopped while it is still running.

## [0.3.0]

### Added

- Global sleep mode to more clearly separate triggers and actions for easier future expansion.
- Version migrations for app settings and automation configurations, to aid preservation of configuration during future
  updates.
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

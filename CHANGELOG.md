# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Some modals automatically closing right after opening them
- Some modals being rendered incorrectly

## [1.13.0]

### Added

- Integration with Home Assistant via MQTT
- Function for VRChat player join/leave notifications
- Automations for changing your VRChat status based on the sleep mode & sleep preparation.
- Avatar automations for changing your VRChat avatar when you fall asleep, wake up, or prepare for bed.
- Option for changing your VRChat status description in the player limit status automations.
- Option to load and save VRChat player lists as presets for automatic invite request acceptance.
- Option to limit automatically accepting invite request based on the number of players in the world.
- Automations for switching between various player list presets for automatic invite request acceptance.
- Automation for disabling the sleep mode when you've been upright for long enough after laying down.
- Automation for automatically disabling the sleep mode when a (certain) VRChat user joins or leaves your world.
- Automation trigger for the shutdown sequence to run when you've been left alone in your VRChat world instance for a certain amount of time.
- Ukrainian language support (Community contribution by [senkodev](https://x.com/senkodev) and [Fanyatsu](https://fanyat.su/))
- Additional configuration options for the sleep detector (controller presence, sleeping pose)
- Options for forcing the power state of base stations (Right click the power button).
- Support for base stations that don't report their status. (Newer lighthouses sold through Valve, likely manufactured by HTC)
- Optional fix to delay initializing OyasumiVR with OpenVR.
- OVRToolkit as a notification provider
- Support for string parameters in OSC scripts (Community contribution by [Fanyatsu](https://fanyat.su/))
- Support for sending multiple parameters in OSC scripts (Community contribution by [Fanyatsu](https://fanyat.su/))

### Changed

- Improved duration selection for sleep duration in shutdown sequence
- Made device edit dialog always show the device serial number in its title.
- Improved sleep detection by considering the sleeping pose
- Improved layouts for sleep detection configuration views
- When the overlay menu is opened while the controller is not tracked, the overlay will open in front of you instead.
- Custom window titlebar

### Fixed

- CJK fonts not properly being loaded in some parts of the overlay UI
- Brightness overlay not covering full view of some high FOV headsets (e.g. Pimax)
- Bigscreen Beyond fan speed often being reset
- VRChat accounts with 2FA being logged out after 7 days. (Now 30 days, if you store credentials)
- The overlay menu sometimes not showing when being opened
- Improved handling of failed configuration migrations

## [1.12.8]

### Fixed

- Pluralization issues causing Japanese- and Korean language translations to break
- Improved initialization performance

## [1.12.7]

### Changed

- Improved device detection for Bigscreen Beyond
- Increased timeout duration for initialization tasks
- Improved telemetry

### Fixed

- Disabled swipe navigation in main window

## [1.12.6]

### Changed

- Improved initialization

## [1.12.5]

### Added

- Crash reporting for initialization errors

## [1.12.4]

### Fixed

- VRChat microphone mute automations blocking keyboard- and controller bindings from toggling the microphone mute state.

## [1.12.3]

### Added

- Options for (conditionally) disabling Discord rich presence, based on sleep mode, or VRChat being active.
- Missing event logs for Bigscreen Beyond fan- and led automations.
- Missing Dutch translations

### Fixed

- Fixed sleep preparation not being available even when some of its automations are enabled.

## [1.12.2]

### Changed

- Reverted back to Tauri v1.6

### Fixed

- Fixed Discord Rich Presence integration preventing OyasumiVR from starting without Discord running

## [1.12.1]

### Changed

- Temporarily disabled Discord rich presence support
- Temporarily reverted to Tauri v1.4

## [1.12.0]

### Added

- Show SteamVR device roles instead of serial numbers in the device list, when available. (by [góngo](https://github.com/TheMrGong))
- Added back VRChat microphone mute automations.
- Hardware brightness control for Bigscreen Beyond.
- Fan control & fan automations for Bigscreen Beyond.
- RGB Led automations for Bigscreen Beyond.
- Options for limiting the maximum hardware brightness.
- Automatic cleanup for log files older than 30 days, or that exceed 10MB.
- Discord rich presence support for showing the current sleep mode.

### Changed

- Redefined "Display Brightness" as "Hardware Brightness", and "Image Brightness" as "Software Brightness".
- Updated sleep detection to include controller button presses as a factor
- Updated overlay sidecar to .NET 8.0
- Upgraded to Tauri v1.6 and updated various dependencies.

### Fixed

- OyasumiVR crashing when trying to read SteamVR's display brightness upon SteamVR quitting.
- Battery level automations not working for trackers.
- MDNS advertisements for OSC & OSCQuery not working for some network configurations.
- System microphone still being muted due to changing controller button behavior, when controller binding is disabled.

### Removed

- Legacy telemetry

## [1.11.5]

### Fixed

- Added performance improvements to OSC message handling, SteamVR device updates, and sleeping pose detection.
- Reduced IPC communication to avoid crashes due to overloading the IPC channels.

## [1.11.4]

### Added

- Added debug option for disabling the OSC and OSCQuery servers
- Flags file for setting debugging flags
- Debugging flag for disabling MDNS (and as a result, OSCQuery) completely.

### Fixed

- Some stability issues with Tauri v1.5, by downgrading back down to Tauri v1.4.

### Changed

- Disabled Rust to Webview logging in release builds.

## [1.11.3]

### Fixed

- Crash for some users without bluetooth adapters when disabling lighthouse control.
- Error for windows power policies sometimes not being set correctly, even when they are.
- Fixed setting of invalid analog gain values
- Updated subdependency which caused a crash when detecting some invalid DNS records.

## [1.11.2]

### Added

- Crash reporting for Rust panics and JS errors in main UI.

### Changed

- Updated telemetry to integrate with [Aptabase](https://aptabase.com/). A
  new [privacy policy](https://aptabase.com/legal/privacy) applies.

## [1.11.1]

### Added

- Option for opening the developer tools in release builds.

## [1.11.0]

### Added

- Automations for controlling the volume and mute state of all system audio devices.
- Russian language support (Community contribution by [Kanjir0](https://x.com/Kanjiro_vrc))
- Hardware mode for the overlay mic mute indicator's voice activity, for use with other games than VRChat.
- A credential saving option for remembering your VRChat credentials.
- Automation for disabling the sleep mode after its been enabled for a specified amount of time.
- An option for your system microphone to change its mute state when joining a world in VRChat.
- Option for preventing the overlay from opening when VRChat is not running.
- Support for custom Windows power policies
- Custom nicknames for controller, tracker, and base station devices.
- Option for ignoring specific basestations in automations.
- Support for setting custom hotkeys (With actions for sleep mode toggling/enabling/disabling, running sleep
  preparation, running the shutdown sequence, and turning devices on and off)
- Detection for initialization failures and error handling.
- Added support for OSCQuery
- Status information view to the settings, for showing technical information regarding OyasumiVR and some of its
  internals.
- Automation for running a OSC script whenever the user prepares to go to sleep.
- Added OSC commands for turning on and turning off all base stations.

### Changed

- When your VRChat session expires and you've opted to store your credentials, OyasumiVR will automatically attempt to
  log you back in.
- Improved reliability of base station power management
- Brightness automations no longer apply on start as a default setting
- Updated to Tauri v1.5
- Rewrote OSC control (Old OSC addresses remain supported, but check the wiki page on OSC control for any updates)

### Fixed

- Updated missing and improved existing Simplified Chinese translations (by [雾雨花精灵](https://github.com/flower-elf)
  and [i0nTempest](https://x.com/i0ntempest)).
- Default bindings sometimes triggering haptics for some users.
- Improved search performance in the friend selection modal for automatically accepting invite requests.

### Removed

- VRChat settings
- OSC configuration options (Now handled by OSCQuery)

## [1.10.4]

### Fixed

- Fixed failing resource preloads sometimes causing OyasumiVR to fail to start.
- Fixed telemetry settings not always being saved properly.

## [1.10.3]

### Added

- Improved initialization logging for debugging purposes

### Removed

- Option for sleep animations to only trigger while all trackers are turned off

### Fixed

- Migration bug for automation configurations.
- Do not register the application manifest in Steam builds.

## [1.10.2]

### Added

- Troubleshooting fix for reregistering OyasumiVR's VR application manifest with SteamVR.

### Changed

- Increased maximum volume for nightmare detection sound effect to 200%.
- Limited simple- and image brightness sliders in overlay to a minimum of 5%.

### Fixed

- Deadlock in logic for reading possible input bindings.
- Updated missing Spanish translations (by [aacal666](https://x.com/aacalde666))
- Updated missing Indonesian translations (by [a9ito](https://x.com/a9ito))

## [1.10.1]

### Added

- Spanish & Indonesian language support to the standalone NSIS installer.

### Changed

- Switched to the default Tauri script for the NSIS installer.

### Fixed

- Missing Japanese translations (by [なき](https://x.com/NoYu_idea)).
- Missing Dutch translations.
- UI issues with some duration unit selectors.

### Removed

- .NET Core & ASP.NET Core runtime installation from the standalone NSIS installer.

## [1.10.0]

### Added

- Various automations for controlling the mute state of the system microphone.
- Simple mode for brightness control that consolidates image- and display brightness.
- Brightness control dialog to directly control brightness from the main window.
- Brightness control sliders to directly control brightness from the overlay.
- Sleep preparation automation for brightness control, to allow for dimming brightness levels already before going to
  sleep.
- Sleep preparation button in the overlay and on the overview, to trigger automations that support this feature.
- Copy buttons to the brightness automation configuration for copying current brightness levels.
- Options to apply sleep-mode based brightness levels on OyasumiVR and SteamVR startup.
- Automation for enabling the sleep mode based on your heart rate. ([Pulsoid](https://pulsoid.net) integration)
- Automation for detecting possible nightmares based on your heart rate. ([Pulsoid](https://pulsoid.net) integration)
- Setting for OyasumiVR to quit alongside SteamVR.
- Instructions on how to start OyasumiVR alongside SteamVR.
- Automations for turning off devices when their battery levels reach below a threshold.
- Shortcut to VRChat related settings from the status bar pill.
- Option for dismissing the sleep check by pressing controller buttons.
- Option for changing the volume of general notification sounds.
- Optional fix for running the SteamVR overlay on systems with hybrid graphics.

### Changed

- Updated translations to use ICU syntax.
- Migrated from Legacy OpenVR Input system to SteamVR's current input system (Controller bindings are now configured in
  SteamVR!)
- Bundled dotnet runtime requirements with overlay sidecar module. (Separate installation no longer required)

### Fixed

- Improvements to the Simplified Chinese translations (by [雾雨花精灵](https://github.com/flower-elf)).
- Disabling OSC features leading to a crash
- A configuration saving loop in status automations view
- Malformed OSC packets causing a crash
- OSC message processing being slower than necessary
- Date formatting for Korean language
- Long VRChat usernames sometimes overflowing on the player list for automatic invite request accepts
- Added workaround for bug in SteamVR 2.0 regarding IVROverlay::ComputeOverlayIntersection.

### Removed

- Dotnet version checking and installation.

## [1.9.0]

### Added

- Allow limiting sleep detection to certain hours of the day.
- Automation toggle for sleep detection (by [góngo](https://github.com/TheMrGong))
- OSC address for toggling the sleep detection automation.
- Spanish language support (Community contribution by [aacal666](https://x.com/aacalde666))
- Indonesian language support (Community contribution by [a9ito](https://x.com/a9ito))
- Support for a release on [Steam](https://store.steampowered.com/)
- VR Manifest for registering OyasumiVR with SteamVR.
- Sleeping animations preset for GoGo Loco 1.8.0+
- Cute drawings (by [Jun](https://x.com/JunHakase)) to the sleep toggle card in the overview

### Changed

- Added missing translations for Traditional and Simplified Chinese. (By [狐 Kon](https://github.com/XoF-eLtTiL))
- Gamma corrected image brightness control (You might have to readjust your brightness settings)

### Fixed

- Fixed issues with detection and installation of missing .NET runtimes
- Fixed Japanese date formatting
- Fixed Japanese font rendering in overlay
- Upgraded various dependencies

### Removed

- Custom VRCFury installation prefabs for GoGo Loco. (You can now use GoGo Loco's own installation prefabs from GoGo
  Loco 1.8.0 onwards!)

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

### Fixed

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

- Various improvements to the Japanese translations (by [なき](https://x.com/NoYu_idea))
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

- Marked the preset for [ごろ寝システム (Sleep System) by みんみんみーん](https://booth.pm/ko/items/2886739) to also
  support v2.3 and
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

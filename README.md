<p align="center">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/logo_light.png?raw=true#gh-light-mode-only" width="450">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/logo_dark.png?raw=true#gh-dark-mode-only" width="450">
    <br/>
    <br/>
    :zzz: A collection of utilities to assist with sleeping in virtual reality.
</p>
<p align="center">
    <a><img alt="Latest Version" src="https://img.shields.io/github/v/tag/Raphiiko/Oyasumi?color=informational&label=version&sort=semver"></a>
    <a><img alt="Production Build Status" src="https://github.com/Raphiiko/Oyasumi/actions/workflows/build-release.yml/badge.svg"/></a>
    <a><img alt="Development Build Status" src="https://github.com/Raphiiko/Oyasumi/actions/workflows/build-development.yml/badge.svg"/></a>
    <a href="https://github.com/Raphiiko/Oyasumi/blob/develop/LICENSE"><img alt="License" src="https://img.shields.io/github/license/Raphiiko/Oyasumi"></a>
    <br>
    <a href="[https://raphiiko.booth.pm](https://discord.gg/7MqdPJhYxC)"><img alt="Discord Badge" src="https://img.shields.io/discord/1023672078672609382?color=5865f2&label=Discord&logo=discord&logoColor=https%3A%2F%2Fshields.io%2Fcategory%2Fother"/></a>
    <a href="https://raphiiko.booth.pm"><img alt="Booth.pm Page" src="https://img.shields.io/badge/Store-BOOTH.PM-red"/></a>
    <a href="https://raphiiko.gumroad.com"><img alt="Gumroad Page" src="https://img.shields.io/badge/Store-Gumroad-important"/></a>
</p>

<p align="center">
  This is the main repository for Oyasumi.<br>It is an open source tool to assist with sleeping in virtual reality (VRChat).
</p>

<p align="center">
  If you want to come chat, join our <a href="https://discord.gg/7MqdPJhYxC"><img src="https://user-images.githubusercontent.com/111654848/192362041-f09cc066-a964-446f-aa2c-fa7a7a31ec05.png" width="16" style="fill: white" /> Discord Server</a>!
</p>

## Getting started

Grab the latest installer over on the [Releases](https://github.com/Raphiiko/Oyasumi/releases) page.

| Sleeping Animations | GPU Power Limiting | Sleep Detection | Battery Automations | Device Overview |
|---------------------|--------------------|-----------------|---------------------|-----------------|
|<img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_sleeping_animations.png" width="100%" crossorigin>|<img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_gpu_automations.png" width="100%" crossorigin>|<img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_sleep_detection.png" width="100%" crossorigin>|<img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_battery_automations.png" width="100%" crossorigin>|<img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_overview.png" width="100%" crossorigin>|

## Features
<img align="right" src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/sleeping_pose.gif" height="333">

- :dizzy: Automatic sleep animations with pose detection
  - Detects your sleeping position to switch between your avatar's sleeping animations automatically.
  - Trigger your own animations with the included OSC script editors.
  - Presets for popular locomotion assets, including:
    - [ごろ寝システム v2.2](https://minminmart.booth.pm/items/2886739) by [みんみんみーん](https://twitter.com/minminmeeean) 
      <br>(Sleep System v2.2 by minminmiin)
    - [GoGo Loco v1.7.1](https://booth.pm/en/items/3290806) by [franada](https://twitter.com/franada)
      <br>(Workaround available for GoGo Loco 1.6.2 - 1.7.0)
- :electric_plug: GPU Automations:
  - Automatically tweak your power limits when you go to sleep and when you wake up.
- :battery: Battery automations:
  - Automatically turn off trackers and/or controllers:
    - When you go to sleep (so you still have some juice left in the morning!)
    - When putting them on a charger
- :wrench: Turning off all trackers and/or controllers with a single click.
- :zzz: Manage automations with a sleep mode in various ways:
  - Detect falling asleep:
    - When a controller or tracker battery percentage falls below a threshold
    - When turning off your controllers
    - On a time schedule
  - Detect waking up:
    - When turning on a controller or tracker
    - On a time schedule
- 🗺️ Multi language support
  - English
  - Dutch (Nederlands)
  - Japanese (日本語)

If you would like to help out with adding more languages and/or missing translations, please check out [the wiki page on adding translations](https://github.com/Raphiiko/Oyasumi/wiki/Adding-Translations) for instructions on how to get started!

### Built With

Oyasumi has been built with [Angular](https://angular.io/) and [Tauri](https://tauri.app/).

## Supported Devices

### Battery Automations
Currently Oyasumi supports battery automations for all SteamVR devices that:
1. Support reporting for battery levels and charging status
2. Support being turned off via SteamVR. 

This includes, but is not limited to the following devices:
- HTC Vive Controllers/Wands
- Index Controllers/Knuckles
- Vive Trackers (1.0/2.0/3.0)
- Tundra Trackers\*

This means that any Oculus controller is unlikely to work, and SlimeVR trackers are unsupported unless they implement this functionality in their [OpenVR driver](https://github.com/SlimeVR/SlimeVR-OpenVR-Driver).

*(\*) Tundra trackers have very delayed reporting of battery levels and charging status. This means that while automations will still work, they will be very delayed (minutes in the double digits), unless Tundra fixes this in their tracker firmware. (https://forum.tundra-labs.com/t/firmware-issues/746)*

### GPU Automations

Currently, only NVIDIA cards are supported for setting power limits. AMD and Intel cards are not yet supported.

## Development

To start development on Oyasumi, start by following Tauri's [prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) (Installing Rust).
Make sure to grab the nightly, as Oyasumi uses some functionality that is not yet available in the current stable release of Rust.

After you have followed the guide and installed Rust, install [NodeJS](https://nodejs.org/en/download/).

It could be helpful to install the [Angular CLI](https://angular.io/cli) globally.

Once you have set up these dependencies, you can continue as follows:

1. Check out Oyasumi on your machine.
2. Run `npm run install` or `yarn`, depending on whether you prefer using `npm` or `yarn`.
3. Run `npm run build` or `yarn build` at least once.

From here, you can run `npm run tauri dev` or `yarn tauri dev` to run the application locally.

## License

Oyasumi is available under the [MIT](https://github.com/Raphiiko/Oyasumi/blob/develop/LICENSE.md) license.

<p align="center">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/logo_light.png?raw=true#gh-light-mode-only" width="450">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/logo_dark.png?raw=true#gh-dark-mode-only" width="450">
    <br/>
    <br/>
    :zzz: A collection of utilities to assist with sleeping in virtual reality. :zzz:
</p>
<p align="center">
    <a><img alt="Latest Version" src="https://img.shields.io/github/v/tag/Raphiiko/Oyasumi?color=informational&label=version&sort=semver"></a>
    <a><img alt="Production Build Status" src="https://github.com/Raphiiko/Oyasumi/actions/workflows/build-release.yml/badge.svg"/></a>
    <a><img alt="Development Build Status" src="https://github.com/Raphiiko/Oyasumi/actions/workflows/build-development.yml/badge.svg"/></a>
    <a href="https://github.com/Raphiiko/Oyasumi/blob/develop/LICENSE"><img alt="License" src="https://img.shields.io/github/license/Raphiiko/Oyasumi"></a>
    <br>
    <a href="[https://raphiiko.booth.pm](https://discord.gg/7MqdPJhYxC)"><img alt="Discord Badge" src="https://img.shields.io/discord/1023672078672609382?color=5865f2&label=Discord&logo=discord&logoColor=https%3A%2F%2Fshields.io%2Fcategory%2Fother"/></a>
    <a href="https://raphiiko.booth.pm/items/4216880"><img alt="Booth.pm Page" src="https://img.shields.io/badge/Store-BOOTH.PM-red"/></a>
    <a href="https://raphiiko.gumroad.com/l/oyasumi?layout=profile"><img alt="Gumroad Page" src="https://img.shields.io/badge/Store-Gumroad-important"/></a>
</p>

<p align="center">
  Oyasumi is an open source tool to assist with sleeping in virtual reality (VRChat).
  <br>
  Oyasumiは、バーチャルリアリティの中で睡眠をアシストするオープンソースソフトウェアです。
  <br>
  <a href="https://raphiiko.booth.pm/items/4216880">booth.pmのストアページ</a>には、日本語の説明文が掲載されています。
</p>

<p align="center">
  If you want to come chat, join our <a href="https://discord.gg/7MqdPJhYxC"><img src="https://user-images.githubusercontent.com/111654848/192362041-f09cc066-a964-446f-aa2c-fa7a7a31ec05.png" width="16" style="fill: white" /> Discord Server</a>!
</p>

## Getting started

Grab the latest installer over on the [Releases](https://github.com/Raphiiko/Oyasumi/releases) page.

<p align="center">
<table>
<tr>
<td><p align="center"><b>Device Overview</b></p></td>
<td><p align="center"><b>Sleeping Animations</b></p></td>
<td><p align="center"><b>GPU Power Limiting</b></p></td>
<td><p align="center"><b>Sleep Detection</b></p></td>
<td><p align="center"><b>Battery Automations</b></p></td>

</tr>
<tr>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_overview.png" width="100%" crossorigin></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_sleeping_animations.png" width="100%" crossorigin></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_gpu_automations.png" width="100%" crossorigin></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_sleep_detection.png" width="100%" crossorigin></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_battery_automations.png" width="100%" crossorigin></p></td>
</tr>
<tr>
<td><p align="center"><b></b></p></td>
<td><p align="center"><b>Status Automations</b></p></td>
<td><p align="center"><b>General Settings</b></p></td>
<td><p align="center"><b>Auto Accept Invite Requests</b></p></td>
<td><p align="center"><b></b></p></td>
</tr>
<tr>
<td><p align="center"></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_status_automations.png" width="100%" crossorigin></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_settings.png" width="100%" crossorigin></p></td>
<td><p align="center"><img src="https://github.com/Raphiiko/Oyasumi/raw/develop/docs/img/screenshot_auto_accept_invite_requests.png" width="100%" crossorigin></p></td>
<td><p align="center"></p></td>
</tr>
</table>
</p>

## Features
<table align="right">
<tr><td><img src="https://user-images.githubusercontent.com/111654848/198073951-85a52109-6fad-4edd-ad53-897a6d8adf12.gif" width="300"></td></tr>
<tr><td><img src="https://user-images.githubusercontent.com/111654848/198073192-efa203e3-95e5-4961-a210-65e30b33cc68.gif" width="300"></td></tr>
</table>

- :dizzy: Automatic sleep animations with pose detection
  - Detects your sleeping position to switch between your avatar's sleeping animations automatically.
  - Trigger your own animations with the included OSC script editors.
  - Presets for popular locomotion assets, including:
    - [ごろ寝システム v2.2 - 2.3](https://minminmart.booth.pm/items/2886739) by [みんみんみーん](https://twitter.com/minminmeeean)
      <br>(Sleep System v2.2 - 2.3 by minminmiin)
      <br>([EX version](https://booth.pm/en/items/4233545) also supported!)
    - [GoGo Loco v1.7.1+](https://booth.pm/en/items/3290806) by [franada](https://twitter.com/franada)
      <br>(Semi-functional workaround available for 1.6.2 - 1.7.0)
- :electric_plug: GPU Automations:
  - Automatically tweak your power limits when you go to sleep and when you wake up.
- :battery: Battery automations:
  - Automatically turn off trackers and/or controllers:
    - When you go to sleep (so you still have some juice left in the morning!)
    - When putting them on a charger
- :large_blue_circle: VRChat Status Automations
  - Automatically change your status based on the number of players in your world:
    <br>_Switch to blue when you are sleeping alone so your friends can join you, and switch to orange when there's enough people around!_
- :wrench: Turning off all trackers and/or controllers with a single click.
- :email: Automatically accept invite requests
  - Automatically let friends in while you are asleep!
  - Configure whose invite requests are accepted using a black- or whitelist.
- :zzz: Manage automations with a sleep mode in various ways:
  - Detect falling asleep:
    - When a controller or tracker battery percentage falls below a threshold
    - When turning off your controllers
    - On a time schedule
  - Detect waking up:
    - When turning on a controller or tracker
    - On a time schedule
- :calling: [Premade expression menu](https://github.com/Raphiiko/Oyasumi/wiki/Oyasumi-Expression-Menu) for controlling some features right from within VRChat
- 🗺️ Multi language support
  - English
  - Dutch (Nederlands)
  - Japanese (日本語)
  - Korean (한국어) (Community contribution by [Soumt](https://github.com/soumt-r))
  - Traditional Chinese (繁體中文) (Community contribution by [狐Kon](https://github.com/XoF-eLtTiL))
  - Simplified Chinese (简体中文) (Community contribution by [狐Kon](https://github.com/XoF-eLtTiL))

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

_(\*) Tundra trackers have very delayed reporting of battery levels and charging status. This means that while automations will still work, they will be very delayed (minutes in the double digits), unless Tundra fixes this in their tracker firmware. (https://forum.tundra-labs.com/t/firmware-issues/746)_

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

## VRChat

Some features of Oyasumi require you to log in with your VRChat account for them to work. (E.g. status automations)

This is only required for features that rely on this. You can use features that don't rely on this without having to provide credentials. 
Your login credentials will never be stored anywhere and are only ever sent to VRChat's servers for authentication purposes. 

Oyasumi isn't endorsed by VRChat and doesn't reflect the views or opinions of VRChat or anyone officially involved in producing or managing VRChat. VRChat is a trademark of VRCHat inc. VRChat © VRChat Inc.

The Oyasumi developer and any of this project's contributors are not responsible for any problems caused by Oyasumi (to your VRChat account or otherwise). Use at your own risk.

## License

Oyasumi is available under the [MIT](https://github.com/Raphiiko/Oyasumi/blob/develop/LICENSE.md) license.

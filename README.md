<p align="center">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/logo_light.png?raw=true#gh-light-mode-only" width="350">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/logo_dark.png?raw=true#gh-dark-mode-only" width="350">
    <br/>
    <br/>
    A collection of utilities to assist with sleeping in virtual reality
</p>
<p align="center">
    <a><img alt="Latest Version" src="https://img.shields.io/github/v/tag/Raphiiko/Oyasumi?color=informational&label=version&sort=semver"></a>
    <a><img alt="Production Build Status" src="https://github.com/Raphiiko/Oyasumi/actions/workflows/build-release.yml/badge.svg"/></a>
    <a><img alt="Development Build Status" src="https://github.com/Raphiiko/Oyasumi/actions/workflows/build-test.yml/badge.svg"/></a>
    <a href="https://github.com/Raphiiko/Oyasumi/blob/develop/LICENSE"><img alt="License" src="https://img.shields.io/github/license/Raphiiko/Oyasumi"></a>
</p>

<p align="center">
    <img src="https://github.com/Raphiiko/Oyasumi/blob/develop/docs/img/screenshot1.png?raw=true" width="600">
</p>

This is the main repository for Oyasumi. It is an open source tool to assist with sleeping in virtual reality.

**Note:** Currently, Oyasumi is in its very early stages. The current functionality is very likely to still contain bugs which I am trying to iron out.


## Getting started

Grab the latest installer over on the [Releases](https://github.com/Raphiiko/Oyasumi/releases) page.

## Features

- :wrench: Turning off all trackers and/or controllers with a single click.
- :battery: Battery automations:
  - Automatically turn off trackers and/or controllers:
    - When their battery percentage falls below a threshold.
    - At a specific time during the night.
    - When both controllers are turned off.
    - When they are put on the charger.
- 🗺️ Multi language support
  - If you would like to help out with adding more languages and/or missing translations, please check out [the wiki page on adding translations](https://github.com/Raphiiko/Oyasumi/wiki/Adding-Translations) for instructions on how to get started!

More sleeping related functionality is still planned.

### Built With

Oyasumi has been built with [Angular](https://angular.io/) and [Tauri](https://tauri.app/).

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

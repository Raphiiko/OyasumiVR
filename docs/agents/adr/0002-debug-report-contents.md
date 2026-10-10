# 0002: What a debug report contains

## Context

A debug report goes to Raphii, as an upload or as a file. It must hold enough to diagnose a problem
without a back-and-forth, and it must never hold credentials. Data outside OyasumiVR's own domain
stays out, even when it would help.

## Decision

The report contains:

- App and system: OyasumiVR version, flavour and build ID, install folder, launch arguments,
  WebView2 version, Windows version and build, CPU, RAM, OyasumiVR memory use, graphics cards and
  driver versions, app language, telemetry and error-reporting flags, available update, time zone,
  local time of the report, and which of a fixed list of other VR apps run.
- OyasumiVR components: overlay sidecar, elevated features (launcher state and last launcher error),
  elevated sidecar and its last failure, gRPC, HTTP and OSC ports, MQTT connection status,
  Bluetooth and lighthouse state and devices, NVML status, power plan, audio devices, Bigscreen
  Beyond, and whether Pulsoid is connected.
- SteamVR: running, version, OpenVR connection state, manifest registration and auto-launch,
  headset model and tracking system, connected devices with serial numbers, refresh rate, render
  resolution, installed and enabled drivers, and `steamvr.vrsettings`.
- VRChat: running, logged in, number of stored accounts, last API errors with IDs in the route
  replaced, which VRChat log file the log parser reads and its last line time, and OSC state.
- Files: OyasumiVR logs of the core, the overlay sidecar, the elevated sidecar and the privileged
  launcher, changed in the past 7 days; `panic.log`; memory-watch incidents without `process.dmp`;
  `settings.dat` with credentials removed; `event_log.dat`; names, sizes and dates of store
  checkpoints and quarantined stores.

The report leaves out SteamVR logs, VRChat's own logs, `cache.dat`, and the contents of
checkpoints and quarantined stores.

At export, the app:

- replaces the Windows username in paths with `<user>`;
- removes the values of `access_token=`, `authToken=` and similar keys from the logs;
- replaces these `settings.dat` values with `"<removed>"`: `authCookie`, `twoFactorCookie`,
  `rememberedCredentials`, `protectedSecret`, `mqttPassword`, `mqttProtectedPassword`, Pulsoid
  `accessToken`, and any key whose name contains `password`, `token`, `cookie` or `secret`;
- drops the oldest log files until the zip fits under 25 MiB.

## Consequences

- Anything OyasumiVR writes to its own logs or settings can reach Raphii: friend names, `usr_` IDs,
  MAC addresses, device names, LAN IPs and user shell commands. Credentials must never go into the
  logs.
- The report does not show the VRChat display name as its own field.
- A new credential in the settings is caught only if its key name matches the pattern. A credential
  under another name needs an entry in the removal list.

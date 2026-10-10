# Troubleshooting page and debug reports

Settings > Troubleshooting shows the app's state and offers the troubleshooting tools. A **debug
report** is a zip of logs, settings with credentials removed, and system, SteamVR and app state. A
user uploads one when Raphii asks, and gets a **report code**, such as `K7Q-M2X`, to pass to Raphii.

## The page states facts

- The page has three sections: Support (version, build and the debug report), Status, and Tools.
- Each status line shows a plain state, such as "Not running" or "Off". SteamVR or VRChat not
  running, or a feature turned off, is a normal state, so the page never colours a line or marks it
  as a problem. A value such as "Connection error" states a fact, not a verdict. A new status line
  needs the same kind of neutral value set.
- Only the administrative permissions line has a detail text, and it describes what happened, such
  as the launcher failure reason.
- Ports, hosts, sidecar internals and other raw values belong in the debug report, not on the page.
- "Clear persistent data" stays in Advanced settings, because it changes data rather than
  diagnosing anything.

## What a debug report contains

Anything OyasumiVR writes to its own logs or settings may go in the report: friend names, `usr_`
IDs, MAC addresses, device names, LAN IPs and user shell commands. Data outside OyasumiVR's own
domain stays out, even when it would help. Credentials never go in, so they must never reach the
logs either.

- **App and system:** version, flavour, build ID, install folder, launch arguments, WebView2
  version, Windows version and build, CPU, RAM, OyasumiVR memory use, graphics cards and driver
  versions, app language, telemetry and error-reporting flags, available update, time zone, local
  time of the report, and which of a fixed list of other VR apps run.
- **OyasumiVR components:** overlay sidecar, elevated features (launcher state and last launcher
  error), elevated sidecar, gRPC, HTTP and OSC ports, MQTT status, Bluetooth and Lighthouse state
  and devices, NVML status, power plan, audio devices, Bigscreen Beyond, and whether Pulsoid is
  connected.
- **SteamVR:** running, version, manifest registration and auto-launch, headset model and tracking
  system, devices with serial numbers, refresh rate, render resolution, installed and enabled
  drivers, and `steamvr.vrsettings`.
- **VRChat:** running, logged in, number of stored accounts, last API errors with the IDs in the
  route replaced, the log file the log parser reads with its last line time, and OSC state. The
  display name appears only where the logs already contain it.
- **Files:** the logs of the core, the overlay sidecar, the elevated sidecar and the privileged
  launcher changed in the past 7 days, `panic.log`, memory-watch incidents without `process.dmp`,
  `settings.dat` with credentials removed, `event_log.dat`, and the names, sizes and dates of store
  checkpoints and quarantined stores.

The report leaves out SteamVR logs, VRChat's own logs, and `cache.dat`, which holds the user's
VRChat friend list. It also leaves out the contents of checkpoints and quarantined stores: the app
cannot parse a broken store, so it cannot remove the credentials from it.

## Scrubbing

At export the app replaces the Windows username in profile paths with `<user>`, and the values of
token-like URL parameters such as `access_token=` with `<removed>`. In `settings.dat` it replaces
every non-empty value under a key containing `password`, `token`, `cookie`, `secret` or
`credentials` with `"<removed>"`. A new credential stored under a key without one of those words
needs its own entry in the scrub rules.

## Upload and storage

- The app posts the zip to `POST https://api.raphii.co/oyasumivr/debug-reports` in RaphiiApi, a
  Cloudflare Worker on the Workers Free plan. Uploads must never cause a Cloudflare bill, including
  under abuse.
- The endpoint stores the zip in Workers KV for 5 days and returns the report code: 6 characters of
  Crockford base32, shown as `K7Q-M2X`. The KV key is `debug-report:K7QM2X`.
- KV on Workers Free fails at its caps instead of billing, so a broken limit can stop uploads for a
  day but cannot cost money. R2 has no hard cap and bills above its free tier, so moving reports
  there needs its own decision.
- The endpoint refuses a zip over 25 MiB, the KV value limit, and allows 10 uploads an hour and 25 a
  day per IP, and 100 a day in total. The limit counters live in D1, so a refused upload spends
  none of the 1,000 daily KV writes.
- The API has no download route. Only Raphii reads reports, with `wrangler`.

## The upload dialog

- An upload starts only after the user confirms a dialog that says what the upload sends. Cancel
  has focus, so Enter cancels.
- "Retry" and "Save to file" appear only when the upload fails. Retry sends the same zip again.
- Every failed upload shows the same generic error. The dialog never shows the reason, such as a
  rate limit, because the reason helps someone who abuses the endpoint.

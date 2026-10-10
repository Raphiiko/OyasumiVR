# 0003: The Troubleshooting page states facts, the debug report holds the details

## Context

The Status Information page listed ports, hosts, sidecar internals and VRChat instance details. Few
users can act on those values, and some, such as the instance ID, are personal. The troubleshooting
actions lived on the Advanced settings page.

## Decision

- A Troubleshooting page replaces the Status Information page. It has three sections: Support
  (version, build, and later the debug report), Status, and Tools.
- Each status line shows a plain state, such as "Not running" or "Off". The page never colours a
  line or marks it as a problem: SteamVR or VRChat not running, or a feature turned off, is a normal
  state.
- Only the administrative permissions line can show a detail text, and only to describe what
  happened, such as the launcher failure reason.
- Ports, hosts, sidecar internals and other raw values move to the debug report only.
- "Open log folder", "Reregister SteamVR application manifest" and "Open Developer Tools" move from
  Advanced settings to Tools. "Clear persistent data" stays in Advanced settings, because it changes
  data rather than diagnosing anything.

## Consequences

- A user who reads the page cannot conclude that something is broken from colour alone. Raphii
  reads the state together with the debug report.
- A new status line needs a neutral value set. A value such as "Error" describes a fact, not a
  verdict.

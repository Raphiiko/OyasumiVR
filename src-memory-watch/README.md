# Temporary beta memory diagnostics

This standalone Windows executable watches OyasumiVR's process tree. It has no
Tauri, WebView2, .NET, network or async-runtime dependency. Monitoring continues
when the root process is suspended. Dump writing and native notifications run
in separate instances of this helper, so neither blocks the sampling loop.

## Automatic beta diagnostics

Every beta launch starts the monitor silently. There is no setup, prompt or
separate executable for the user to run. It can capture the first qualifying
incident from a fresh installation.

Nothing uploads automatically. Diagnostics live in
`%LOCALAPPDATA%/OyasumiVR/memory-watch`. Only versions containing `-beta` launch
the watcher. Normal releases do not start it. The watcher does not start when
the main app runs as administrator, which OyasumiVR does not support.

After a capture, a native dialog offers to open the `incident` folder. It also
appears on the next monitored launch, so the tester can find a capture made
overnight. Share the folder privately. A full dump can contain credentials,
messages and other private data. Do not attach it to a public GitHub issue.

When OyasumiVR exits, the monitor stops sampling and releases its startup lock.
If a dump is active, it stays until completion or the timeout notice. The dump
writer can finish independently and holds the incident folder against moves
or deletion until it exits.
Move the `incident` folder elsewhere before restarting OyasumiVR to arm another
capture. No action is needed before the first capture.

## Collection

- Sample every two seconds using Windows process snapshots and memory counters.
- Follow children recursively, including WebView2 browser, renderer, GPU and
  utility processes. Remember discovered descendants while they remain alive,
  even if an intermediate parent exits.
- Identify processes by PID and creation time. Do not follow a recycled PID.
- Include the elevated sidecar through its registered PID and creation time.
  Its scheduled-task launch can place it outside the root's process tree.
- Exclude the watchdog and its dump/notification children from the thresholds.
- Record private committed bytes, resident bytes, process names, parent PIDs,
  creation times and measurement errors. Do not collect command lines.
- Trigger after one process has at least 2 GiB of private committed memory for
  15 seconds, or the measured processes together have at least 4 GiB for 15
  seconds. A trigger is a diagnostic threshold, not proof of a leak.
- Capture the largest qualifying process once. For the aggregate trigger,
  capture the largest process and retain measurements for all the others.
- Save the build/version, process report, recent history and up to three 1 MiB
  application log excerpts. Full-memory dumps include thread and module data.

Recent history stays in memory, capped at 120 samples and 256 KiB of serialized
data. Normal sampling does not write history or application logs to disk. One
incident persists across launches; it prevents further automatic dumps until
the tester moves or removes it. Capture requires disk headroom of private plus
resident bytes plus 1 GiB. Targets whose private plus resident bytes exceed
8 GiB fall back to manual capture. The dump callback requests cancellation
after 120 seconds, 8 GiB written or less than 512 MiB disk space remaining.
These callback budgets are best effort, not hard limits on a blocked OS call.
After 150 seconds the monitor offers the manual instructions even if the writer
has not returned. It never forcibly kills a writer that may have suspended
target threads.

`status.txt` distinguishes success from failure. `process.dmp` appears only
after successful completion; incomplete captures use `.partial` and are deleted
on a handled failure. Failed captures retain instructions naming the exact
process and PID. Elevated processes may require manual capture from an elevated
Task Manager; this helper never requests elevation.

Process sampling can miss a child that starts and exits between snapshots, or
one whose intermediate parent disappears before its first snapshot. Access
restrictions are reported where Windows exposes the relationship. System-wide
memory exhaustion or disk stalls can still delay the helper. A dump identifies
retained memory but does not necessarily identify allocation call stacks; keep
the matching build's symbols for analysis.

## Build and verify

```powershell
node src-memory-watch/build.mjs
cargo test --manifest-path src-memory-watch/Cargo.toml --locked
cargo clippy --manifest-path src-memory-watch/Cargo.toml --locked -- -D warnings
powershell -NoProfile -ExecutionPolicy Bypass -File src-memory-watch/test.ps1
```

The PowerShell check uses its own temporary profile and fixture processes. It
verifies quiet startup without setup files or history writes, descendants,
sampling and capture while the root is suspended, registration of an unrelated
fixture, a real full-memory dump, rejection of a stale process identity, and
shutdown after the root exits. It leaves its results and fixture dump in the
printed temporary directory. It does not launch OyasumiVR or show dialogs.

The test also commits 2 GiB of inaccessible virtual memory in its fixture to
exercise the real automatic threshold without touching those pages. Allow at
least 3 GiB of spare system commit and disk space. It holds the notification
lock during this check to avoid opening a dialog on the desktop.

The existing pre-build script builds and stages the helper under
`src-core/resources/memory-watch`. Tauri's resource glob and Steam's resource
copy package it without another packaging rule. The build embeds the current
`src-ui/build.ts` build ID. English diagnostic copy is hardcoded in this helper.

## Removal

Delete this folder, the `memory_watch` module declaration and launch call in
`src-core/src/main.rs`, the registration call in
`src-core/src/elevated_sidecar/mod.rs`, the import in `scripts/pre-build.js`, and
the resource ignore entry in `src-core/.gitignore`. Remove the generated
`resources/memory-watch` folder from build outputs before packaging another
release.
Users can delete their local diagnostic folder after saving any evidence.

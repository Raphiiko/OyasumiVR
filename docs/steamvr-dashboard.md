# SteamVR dashboard

The Rust core registers an OyasumiVR dashboard tab when SteamVR connects. It displays the existing main WebView, preserving the single Angular application and its business logic. The hand-mounted sidecar menus are separate.

## Window and rendering

Selecting the tab hides the desktop window and gives its WebView a 1600 by 900 viewport at scale 1. The panel is about 2.67 by 1.5 meters before SteamVR applies the user's dashboard scale.

Leaving the tab restores the WebView's bounds, zoom, scale and visibility. The desktop window's native size, position and maximized state remain intact. Opening the desktop window while the tab is active returns control to the desktop until the tab is reselected.

The existing overlay hardware-acceleration setting selects capture:

- Enabled: reparent the WebView into an offscreen native host, capture with Windows Graphics Capture, then copy into a shared D3D11 texture on SteamVR's adapter. The application does not read back or encode GPU frames.
- Disabled: capture PNGs with WebView2, decode on the CPU, then upload to the submission texture. Requests are limited to ten per second.

The capture device is created when SteamVR connects, so OyasumiVR may start first. The Chromium renderer can use a different adapter; this change does not set its GPU preference. CPU capture does not change the main browser's startup acceleration setting.

Capture requests run only while this tab is selected, with one request in flight. The active dashboard loop waits 8 ms between ticks; ordinary VR device updates remain limited to one per 32 ms. A five-second capture timeout stops the overlay and restores the desktop. VR shutdown also releases the overlay and capture host.

## Input

OpenVR pointer coordinates use the texture dimensions and are converted to browser coordinates. WebView2's local DevTools API delivers mouse and keyboard input without moving the desktop cursor or injecting OS input.

Pending pointer and scroll events combine in place. Button events preserve ordering, and neither movement nor scrolling can push the other to the back indefinitely. Scroll updates accumulate per-element targets. One browser animation loop advances them with a 40 ms time constant, preserving continuous motion.

Leaving the panel cancels scrolling and releases held mouse buttons. Desktop window controls are hidden while in VR; the message center remains available.

Clicking an editable input or textarea opens SteamVR's per-key keyboard. Characters edit the existing field at its caret or selection. Backspace, Delete, arrows and Enter use native browser editing behavior. Each keyboard event checks the field's session, focus and editability. Existing field text is not sent to SteamVR. Done or dismissal finishes editing and keeps text already entered.

Native file dialogs, native popup menus, contenteditable editors and drag-to-scroll are not implemented for VR.

## Checks

The Windows checks in `tools/dashboard-capture-probe` compile the production capture and input modules. Run from that directory with a Rust toolchain compatible with the main app:

```powershell
cargo run --locked --bin dashboard-capture-probe
cargo run --locked --bin gpu -- 0
cargo run --locked --bin input
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--disable-gpu'
cargo run --locked --bin input
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
```

The default check verifies hidden CPU capture and trusted clicks, and writes ignored frame PNGs. The GPU check takes a DXGI adapter index and verifies changing pixels and repeated capture restoration. The input check covers clicks, dragging, scroll cadence, cancellation, Unicode caret editing, field metadata and re-entry.

Headset testing confirmed panel geometry, desktop restoration including maximized windows, pointer interaction, smooth scrolling and per-key typing. Follow `docs/agents/desktop-ui-testing.md` for future application checks. Also check disconnects and acceleration changes when modifying capture ownership.

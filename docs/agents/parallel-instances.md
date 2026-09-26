# Parallel app instances

Every worktree can run its own OyasumiVR dev instance at the same time as the others. Start it with:

```powershell
npm run dev:isolated
```

The script prints one line before the build starts:

```text
[dev-isolated] identifier=co.raphii.oyasumi.dev.<worktree>-<hash> ui=http://localhost:<port> cdp=<port> data=%APPDATA%\co.raphii.oyasumi.dev.<worktree>-<hash>
```

Read the frontend URL and the CDP port from that line. Each worktree runs one instance at most.

The snippets below use `$executable`, the worktree's backend:

```powershell
$executable = Join-Path (Resolve-Path .).Path 'src-core\target\debug\oyasumivr.exe'
```

## What the script isolates

The script runs `tauri dev --config` with a patch that changes three values:

- **`identifier`** becomes `co.raphii.oyasumi.dev.<worktree>-<hash>`, where `<worktree>` is the
  folder name and `<hash>` comes from the full worktree path. The single-instance lock, the
  settings and store files, the logs, the image cache, and the WebView2 profile all derive from the
  identifier, so the instance shares none of them with other worktrees or with the installed app.
- **`devUrl` and `beforeDevCommand`** move `ng serve` off port 4200. The script derives the port from
  the identifier and moves up to the next free one. It holds a claim on the UI port plus 10000 until
  it exits, so two launches at the same moment never pick the same ports.
- **`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`** opens CDP on the UI port plus 5000.

The core, gRPC, HTTP, OSC, and OSCQuery servers bind ephemeral ports, so they need no patch.

The instance starts with empty settings, so its first run shows the language picker. The data
directory keeps that choice and every other setting for the next run in the same worktree.

## What stays shared

These resources exist once per machine. Claim the matching lock before a test touches one:

| Lock                                | Claim it when the test                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `Global\OyasumiVR-Test-SteamVR`     | runs while SteamVR runs, starts SteamVR, or works on the overlays      |
| `Global\OyasumiVR-Test-VRChat`      | uses the VRChat client, a fake `VRChat.exe`, or a synthetic VRChat log |
| `Global\OyasumiVR-Test-Elevated`    | uses GPU power limits, MSI Afterburner, or the privileged launcher     |
| `Global\OyasumiVR-Test-Bluetooth`   | uses Lighthouse power control or the Bluetooth radio                   |
| `Global\OyasumiVR-Test-NativeInput` | focuses a window, moves the mouse, or captures the screen              |

The reasons:

- **SteamVR** has one runtime, and the overlay keys (`co.raphii.oyasumivr:MainDashboard` and the
  others) are fixed. Every running instance connects to SteamVR by itself, lock or not, creates
  those overlays, and starts an overlay sidecar. So hold the SteamVR lock for the whole run, and
  after you take it, check that no other worktree runs an instance. If one does, release the lock
  and retry later:

  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='oyasumivr.exe'" |
      Where-Object ExecutablePath -ne $executable
  ```

- **VRChat**: every instance reads the same log directory and watches for the same process, so a
  fake join reaches all of them. Every instance also advertises OSCQuery as "OyasumiVR".
- **Elevated features** use one scheduled task, one `%ProgramFiles%\OyasumiVR\privileged\`, and the
  handshake file `%LOCALAPPDATA%\co.raphii.oyasumi\elevated-sidecar-handshake.json`.
- **Bluetooth** devices accept one controller at a time.
- **Native input** acts on the one foreground window and the one mouse. CDP input goes to one
  WebView2 target and needs no lock. Hold `NativeInput` from the focus call until the screenshot
  after the action.

Claim a lock in the persistent PowerShell session that runs the test:

```powershell
function Enter-TestLock([string]$resource) {
    $mutex = [System.Threading.Mutex]::new($false, "Global\OyasumiVR-Test-$resource")
    try {
        if (-not $mutex.WaitOne([TimeSpan]::FromMinutes(1))) {
            $mutex.Dispose()
            throw "Another agent holds the $resource lock. Retry later."
        }
    } catch [System.Threading.AbandonedMutexException] {}
    $mutex
}

$steamVrLock = Enter-TestLock 'SteamVR'
# ... the part of the test that needs SteamVR ...
$steamVrLock.ReleaseMutex()
$steamVrLock.Dispose()
```

Windows releases a named mutex when the process that holds it exits, so a crashed session frees its
locks. Release each lock from the same session as soon as that part of the test ends.

The deep-link scheme `oyasumivr://` points at the instance that started last, so opening a link
through Windows can reach another worktree. Pass the link to your own executable instead. The new
process hands it to the running instance with the same identifier and exits:

```powershell
& $executable 'oyasumivr://<path>'
```

## Overlay work

The overlay sidecar starts only when SteamVR runs. To run it from source, hold the SteamVR lock, then
start the instance with the dev flags, and `npm run start:overlay-ui` and `npm run start:overlay`
beside it:

```powershell
npm run dev:isolated -- -- -- --core-mode dev --overlay-sidecar-mode dev
```

Dev mode binds the fixed ports 5173 to 5177. The SteamVR lock covers other agents, but a plain
`npm run dev`, such as one in the main checkout, binds the same ports. Check that nothing listens on
them before you start:

```powershell
Get-NetTCPConnection -LocalPort (5173..5177) -State Listen -ErrorAction SilentlyContinue
```

## Clean up

The instance's data stays in `%APPDATA%\<identifier>` and `%LOCALAPPDATA%\<identifier>`, so the
next run in the same worktree keeps its settings. Delete both directories when you remove the worktree.

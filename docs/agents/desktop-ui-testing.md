# Desktop UI verification

Use this procedure when a ticket changes behavior the user can see in the OyasumiVR desktop app.
Prefer CDP through WebView2 for Angular workflows: it drives the real frontend and Tauri IPC while
capturing page screenshots and DOM state. CDP does not exercise native focus or OS input, so use
PowerShell with user32 and screen capture for native-window behavior, or when CDP cannot attach to
the reviewed target. Keep the two layers distinct in the evidence.

## Reserve the desktop

Ask the user before launching or operating OyasumiVR. Run the claim, launch, verification, and
cleanup work in one persistent PowerShell session, then acquire the global test slot:

```powershell
$owned = $false
$mutex = [System.Threading.Mutex]::new($true, 'Global\OyasumiVR-AgentUI-Test', [ref]$owned)
if (-not $owned) {
    $mutex.Dispose()
    throw 'Another agent is testing OyasumiVR. Wait or ask the user; do not compete for the app.'
}
```

Inspect existing processes by full executable path and command line:

```powershell
$workspace = (Resolve-Path .).Path
$executable = Join-Path $workspace 'src-core\target\debug\oyasumivr.exe'

Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -eq $executable -or
    $_.Name -ieq 'oyasumivr.exe' -or
    $_.CommandLine -imatch 'tauri dev|ng serve oyasumivr'
} | Select-Object ProcessId, Name, ExecutablePath, CommandLine
```

```powershell
Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
        [pscustomobject]@{
            Port = $_.LocalPort
            ProcessId = $_.OwningProcess
            Path = $owner.ExecutablePath
            CommandLine = $owner.CommandLine
        }
    }
```

Never stop or reuse a process from another worktree or an unowned session. If the scan cannot prove
that port 4200 and every OyasumiVR process are unrelated to the app, stop and ask the user. This
phase is complete when `$owned` is true and either there is no frontend listener or the user has
resolved the conflict.

## Launch the reviewed build

Record the commit and create an evidence directory before starting:

```powershell
$head = git rev-parse HEAD
$treeStatus = git status --porcelain
$session = Join-Path ([IO.Path]::GetTempPath()) "oyasumivr-ui-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $session | Out-Null
$head, $treeStatus | Set-Content (Join-Path $session 'head.txt')
```

Set the WebView2 debugging argument in the same persistent session that starts npm, then launch the
repository's development profile:

```powershell
$cdpPort = 9222
if (Get-NetTCPConnection -LocalPort $cdpPort -State Listen -ErrorAction SilentlyContinue) {
    throw "CDP port $cdpPort is already in use; choose an unused port."
}
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdpPort"
$dev = Start-Process npm.cmd -ArgumentList run,dev -WorkingDirectory $workspace -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $session 'dev.out.log') `
    -RedirectStandardError (Join-Path $session 'dev.err.log')
$dev | Select-Object Id, ProcessName, Path
```

Wait for frontend and backend startup, then prove their identity:

```powershell
$deadline = [DateTime]::UtcNow.AddSeconds(60)
$frontendMatched = $false
do {
    $frontendPid = Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
    if ($frontendPid) {
        $frontend = Get-CimInstance Win32_Process -Filter "ProcessId=$frontendPid"
        if ($frontend.CommandLine -like "*$workspace*") {
            $frontendMatched = $true
            break
        }
    }
    Start-Sleep -Milliseconds 500
} while (-not $frontendMatched -and [DateTime]::UtcNow -lt $deadline)
if (-not $frontendMatched) {
    throw "No frontend from $workspace owns port 4200."
}

$process = Get-CimInstance Win32_Process -Filter "Name='oyasumivr.exe'" |
    Where-Object ExecutablePath -eq $executable
if (@($process).Count -ne 1) {
    throw "Expected one reviewed OyasumiVR process, found $(@($process).Count)."
}

$frontend | Select-Object ProcessId, ExecutablePath, CommandLine
$process | Select-Object ProcessId, ExecutablePath, CommandLine
```

Do not continue until the recorded HEAD is the reviewed HEAD, port 4200 is owned by this worktree,
exactly one backend has the exact `$executable` path, and `$dev` is the test's recorded root process.

## Verify the WebView2 target

Prove that the debugging endpoint belongs to this app before using it:

```powershell
$endpoint = "http://127.0.0.1:$cdpPort/json/version"
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$version = $null
do {
    try { $version = Invoke-RestMethod $endpoint; break }
    catch { Start-Sleep -Milliseconds 250 }
} while ([DateTime]::UtcNow -lt $deadline)
if (-not $version) { throw "CDP did not open on port $cdpPort." }

$cdpPid = Get-NetTCPConnection -LocalPort $cdpPort -State Listen |
    Select-Object -First 1 -ExpandProperty OwningProcess
$cdpProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$cdpPid"
if ($cdpPid -ne $process.ProcessId -and $cdpProcess.ParentProcessId -ne $process.ProcessId) {
    throw "CDP port $cdpPort belongs to process $cdpPid, not the reviewed backend or its WebView2 child."
}

$targets = Invoke-RestMethod "http://127.0.0.1:$cdpPort/json/list"
$version | Select-Object Browser
$targets | Select-Object title, url, webSocketDebuggerUrl
```

Select the target whose URL starts with `http://localhost:4200`, not another app or the splashscreen.
Record its `webSocketDebuggerUrl`, CDP port, and target URL. If there is not exactly one reviewed
frontend target, stop and reconcile startup before driving the app.

Connect with `System.Net.WebSockets.ClientWebSocket` or a temporary local CDP client. Use
`Input.dispatchMouseEvent` and `Input.dispatchKeyEvent` for browser-level user input,
`Page.captureScreenshot` for visual evidence, and `Page.navigate` only when the workflow requires
navigation. Use `Runtime.evaluate` to read DOM, route, console, or network state; do not call
application methods, set values, or perform actions through JavaScript.

Exercise every workflow in the ticket's acceptance contract. After each meaningful action, wait for
the resulting route or DOM state, capture a page screenshot, and inspect it before continuing. If a
contract requires physical hardware, confirm the required device is connected and record its
identifier or count. A mocked, backend-only, or headless substitute cannot satisfy the app-level
pass.

This phase is complete when each acceptance workflow has been driven through the real frontend and
its before-and-after state is captured from the reviewed target.

## Add native evidence

For native focus, geometry, resizing, OS-level input, or when CDP cannot attach, drive the real
window from the same session. Use `System.Windows.Automation` where its accessibility tree can find
or verify a native control more reliably than coordinates. Initialize once:

```powershell
Add-Type -AssemblyName System.Drawing
if (-not ('Native.User32' -as [type])) {
    Add-Type -Namespace Native -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, IntPtr extra);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out RECT rectangle, int size);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}
[Native.User32]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
```

Select, focus, and capture the reviewed window:

```powershell
$windows = @(Get-Process oyasumivr |
    Where-Object Path -eq $executable |
    Where-Object MainWindowHandle -ne 0)
if ($windows.Count -ne 1) {
    throw "Expected one reviewed OyasumiVR window, found $($windows.Count)."
}

$window = $windows[0].MainWindowHandle
[void][Native.User32]::ShowWindowAsync($window, 9)
[void][Native.User32]::SetForegroundWindow($window)
Start-Sleep -Milliseconds 300
if ([Native.User32]::GetForegroundWindow() -ne $window) {
    throw 'The reviewed OyasumiVR window did not take foreground focus.'
}

$rectangle = [Native.User32+RECT]::new()
$rectangleSize = [Runtime.InteropServices.Marshal]::SizeOf([type][Native.User32+RECT])
$dwmResult = [Native.User32]::DwmGetWindowAttribute($window, 9, [ref]$rectangle, $rectangleSize)
if ($dwmResult -ne 0) { throw "DWM could not report the visible window bounds: $dwmResult" }
$width = $rectangle.Right - $rectangle.Left
$height = $rectangle.Bottom - $rectangle.Top
if ($width -le 0 -or $height -le 0) { throw 'The reviewed window has no usable rectangle.' }

$screenshotPath = Join-Path $session 'native-before.png'
$bitmap = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rectangle.Left, $rectangle.Top, 0, 0, $bitmap.Size)
$bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
```

Click only at a point just observed in that screenshot:

```powershell
$x = 0
$y = 0
[void][Native.User32]::SetCursorPos($rectangle.Left + $x, $rectangle.Top + $y)
Start-Sleep -Milliseconds 60
[Native.User32]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Native.User32]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
```

Capture another window-relative screenshot after every native action and inspect it before the next
one. If OS focus is taken by another window, stop rather than clicking blindly. This phase is
complete when native behavior and page-level behavior are reported as separate evidence.

## Report and clean up

For each verified workflow, report all of the following:

- reviewed HEAD and whether the tree was clean or had uncommitted changes
- exact backend executable path, PID, frontend PID, and proof that both came from this worktree
- route used for each action: WebView2 CDP or native window
- CDP port and target URL when CDP was used
- UI path followed, visible before-and-after results, and screenshot paths
- hardware identifiers or counts when the contract requires hardware
- relevant `dev.out.log`, `dev.err.log`, application, frontend, backend, or installer evidence

Any code change makes affected evidence stale. Re-run the affected workflow on the new HEAD before
claiming verification. Preserve the `$session` directory until its evidence has been reported.

Before stopping anything, enumerate the descendants of `$dev.Id` with their paths and command lines.
Stop `$dev` first, then only descendants still running from that recorded tree. Remove only files
created in `$session`, after the user has the evidence or agrees it can be removed. Release the claim
from the owning session:

```powershell
if ($owned) {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
```

If a process, port, focus, or mutex belongs to another test, leave it alone and ask the user.

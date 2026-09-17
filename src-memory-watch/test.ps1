param([int]$FixtureDepth = -1, [string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'

if ($FixtureDepth -ge 0) {
    [IO.File]::WriteAllText((Join-Path $FixtureDirectory "$FixtureDepth.pid"), "$PID")
    if ($FixtureDepth -lt 2) {
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
            '-FixtureDepth', ($FixtureDepth + 1), '-FixtureDirectory', "`"$FixtureDirectory`""
        ) | Out-Null
    }
    $allocation = [IntPtr]::Zero
    while (-not (Test-Path (Join-Path $FixtureDirectory 'stop'))) {
        if ($FixtureDepth -eq 0 -and $allocation -eq [IntPtr]::Zero -and (Test-Path (Join-Path $FixtureDirectory 'allocate'))) {
            Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WatchFixtureMemory {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr VirtualAlloc(IntPtr address, UIntPtr size, uint type, uint protection);
}
'@
            $allocation = [WatchFixtureMemory]::VirtualAlloc([IntPtr]::Zero, [UIntPtr]::new(3238002688), 0x3000, 0x01)
            if ($allocation -eq [IntPtr]::Zero) { throw 'Fixture allocation failed.' }
        }
        Start-Sleep -Milliseconds 100
    }
    exit
}

$watchExe = Join-Path $PSScriptRoot 'target\release\oyasumivr-memory-watch.exe'
if (-not (Test-Path $watchExe)) { throw 'Build the release helper first.' }
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) "oyasumivr-memory-watch-$([guid]::NewGuid().ToString('N'))"
$data = Join-Path $testDirectory 'OyasumiVR\memory-watch'
$fixtures = Join-Path $testDirectory 'fixtures'
New-Item -ItemType Directory -Path $data, $fixtures | Out-Null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WatchTestNative {
    [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr process);
    [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr process);
}
'@

function Start-WatchHelper([string]$Arguments) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $watchExe
    $start.Arguments = $Arguments
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.EnvironmentVariables['LOCALAPPDATA'] = $testDirectory
    return [Diagnostics.Process]::Start($start)
}

function Wait-For([scriptblock]$Check, [string]$Description, [int]$Seconds = 20) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Check) { return }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out: $Description"
}

$root = $null
$watcher = $null
$suspended = $false
$notificationLock = $null
$startupLock = $null
try {
    $root = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
        '-FixtureDepth', 0, '-FixtureDirectory', "`"$fixtures`""
    )
    Wait-For { Test-Path (Join-Path $fixtures '2.pid') } 'fixture grandchildren'
    $fixtureIds = @(0..2 | ForEach-Object { [int](Get-Content (Join-Path $fixtures "$_.pid")) })
    $created = $root.StartTime.ToFileTimeUtc()
    $startupLock = [IO.File]::Open((Join-Path $data 'watch.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $watcher = Start-WatchHelper "--watch $($root.Id) $created test-beta `"$fixtures`""
    Start-Sleep -Milliseconds 250
    if ($watcher.HasExited) { throw 'Watcher did not wait for the previous watcher lock.' }
    $startupLock.Dispose()
    $startupLock = $null
    Wait-For { Test-Path (Join-Path $data 'watch.lock') } 'automatic watcher startup without setup'
    $watcher.Refresh()
    $cpuBefore = $watcher.TotalProcessorTime.TotalSeconds
    Start-Sleep -Seconds 6
    $watcher.Refresh()
    $idleCpuSeconds = $watcher.TotalProcessorTime.TotalSeconds - $cpuBefore
    if ($watcher.HasExited) { throw 'Watcher exited during normal sampling.' }
    if (@(Get-ChildItem $data -File | Where-Object Length -gt 0).Count -ne 0) { throw 'Normal sampling wrote data to disk.' }
    if (Test-Path (Join-Path $data 'incident')) { throw 'Normal startup created an incident.' }

    $extra = Get-Process -Id $PID
    [IO.File]::WriteAllText((Join-Path $data "extra-$($root.Id).txt"), "$PID $($extra.StartTime.ToFileTimeUtc())")
    $notificationLock = [IO.File]::Open((Join-Path $data 'notification.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Write, [IO.FileShare]::None)
    [IO.File]::WriteAllText((Join-Path $fixtures 'allocate'), '')
    Wait-For { $root.Refresh(); $root.PrivateMemorySize64 -ge 3221225472 } 'fixture private commit threshold'
    if ([WatchTestNative]::NtSuspendProcess($root.Handle) -ne 0) { throw 'Cannot suspend fixture.' }
    $suspended = $true
    $suspendedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $incident = Join-Path $data 'incident'
    Wait-For { Test-Path (Join-Path $incident 'process.dmp') } 'automatic capture while root is suspended' 60
    $automatic = Get-Content (Join-Path $incident 'report.json') -Raw | ConvertFrom-Json
    if ($automatic.target.pid -ne $root.Id) { throw 'Automatic capture selected the wrong process.' }
    if (@($automatic.processes | Where-Object { $_.id.pid -in $fixtureIds }).Count -ne 3) { throw 'Missing process generation.' }
    if ($automatic.processes.id.pid -notcontains $PID) { throw 'Registered process missing.' }
    if ($automatic.processes.id.pid -contains $watcher.Id) { throw 'Watcher included itself.' }
    $history = @(Get-Content (Join-Path $incident 'history.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
    if (@($history | Where-Object { $_.unixSeconds -gt ($suspendedAt + 4) }).Count -lt 2) { throw 'No continued sampling while root was suspended.' }
    $dump = Join-Path $incident 'process.dmp'
    $stream = [IO.File]::OpenRead($dump)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        if ($reader.ReadUInt32() -ne 0x504d444d) { throw 'Invalid minidump signature.' }
        $stream.Position = 8
        $count = $reader.ReadUInt32()
        $directoryOffset = $reader.ReadUInt32()
        $fullMemory = $false
        for ($index = 0; $index -lt $count; $index++) {
            $stream.Position = $directoryOffset + $index * 12
            if ($reader.ReadUInt32() -eq 9) { $fullMemory = $true }
        }
        if (-not $fullMemory) { throw 'Dump lacks full-memory stream.' }
    } finally { $stream.Dispose() }

    $failed = Join-Path $data 'test-reused-pid'
    New-Item -ItemType Directory -Path $failed | Out-Null
    $writer = Start-WatchHelper "--dump $($root.Id) $($created + 1) `"$failed`""
    if (-not $writer.WaitForExit(10000) -or $writer.ExitCode -eq 0) { throw 'Reused PID was not rejected.' }
    if (Test-Path (Join-Path $failed 'process.dmp')) { throw 'Wrong-identity dump was created.' }

    $watcher.Refresh()
    $summary = [ordered]@{
        quietStartup = 'no setup marker, no prompt and no history writes'
        startupContention = 'waited for the previous watcher lock'
        idleCpuSecondsOverSixSeconds = $idleCpuSeconds
        tree = 'root, child and grandchild found'
        suspendedRoot = 'monitor kept sampling'
        extraProcess = 'registered non-descendant found'
        dump = 'valid full-memory dump of suspended fixture'
        dumpBytes = (Get-Item $dump).Length
        reusedPid = 'rejected'
        automaticCapture = 'real 3 GiB private-commit threshold produced report and dump'
        watcherPrivateBytes = $watcher.PrivateMemorySize64
        watcherWorkingSet = $watcher.WorkingSet64
    }
    [WatchTestNative]::NtResumeProcess($root.Handle) | Out-Null
    $suspended = $false
    [IO.File]::WriteAllText((Join-Path $fixtures 'stop'), '')
    if (-not $root.WaitForExit(10000)) { throw 'Fixture did not exit.' }
    if (-not $watcher.WaitForExit(10000)) { throw 'Monitor did not exit with its root.' }
    $summary['shutdown'] = 'watcher exited after root exited'
    $summary | ConvertTo-Json | Tee-Object -FilePath (Join-Path $testDirectory 'results.json')
    Write-Output "Evidence: $testDirectory"
} finally {
    if ($suspended -and $root) { [WatchTestNative]::NtResumeProcess($root.Handle) | Out-Null }
    [IO.File]::WriteAllText((Join-Path $fixtures 'stop'), '')
    foreach ($owned in @($watcher, $root)) {
        if ($owned -and -not $owned.HasExited) { $owned.Kill(); $owned.WaitForExit() }
    }
    if ($notificationLock) { $notificationLock.Dispose() }
    if ($startupLock) { $startupLock.Dispose() }
}

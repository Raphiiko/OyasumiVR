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
            $allocation = [WatchFixtureMemory]::VirtualAlloc([IntPtr]::Zero, [UIntPtr]::new(2164260864), 0x3000, 0x01)
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
[IO.File]::WriteAllText((Join-Path $data 'enabled'), 'Isolated test fixtures only.')

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

function Read-LatestSample {
    $history = Join-Path $data 'history.jsonl'
    if (-not (Test-Path $history)) { return $null }
    $lines = @(Get-Content $history)
    for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        try { return ($lines[$index] | ConvertFrom-Json) } catch { }
    }
    return $null
}

$root = $null
$watcher = $null
$suspended = $false
$notificationLock = $null
try {
    $root = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
        '-FixtureDepth', 0, '-FixtureDirectory', "`"$fixtures`""
    )
    Wait-For { Test-Path (Join-Path $fixtures '2.pid') } 'fixture grandchildren'
    $fixtureIds = @(0..2 | ForEach-Object { [int](Get-Content (Join-Path $fixtures "$_.pid")) })
    $created = $root.StartTime.ToFileTimeUtc()
    $watcher = Start-WatchHelper "--watch $($root.Id) $created test-beta `"$fixtures`""
    Wait-For {
        $sample = Read-LatestSample
        @($sample.processes | Where-Object { $_.id.pid -in $fixtureIds }).Count -eq 3
    } 'all three process generations'
    if ((Read-LatestSample).processes.id.pid -contains $watcher.Id) { throw 'Watcher included itself.' }

    if ([WatchTestNative]::NtSuspendProcess($root.Handle) -ne 0) { throw 'Cannot suspend fixture.' }
    $suspended = $true
    $before = (Read-LatestSample).unixSeconds
    Wait-For { (Read-LatestSample).unixSeconds -gt ($before + 2) } 'sampling while root is suspended'

    $extra = Get-Process -Id $PID
    [IO.File]::WriteAllText((Join-Path $data "extra-$($root.Id).txt"), "$PID $($extra.StartTime.ToFileTimeUtc())")
    Wait-For { (Read-LatestSample).processes.id.pid -contains $PID } 'registered process outside the root tree'
    Remove-Item -LiteralPath (Join-Path $data "extra-$($root.Id).txt")

    $incident = Join-Path $data 'test-capture'
    New-Item -ItemType Directory -Path $incident | Out-Null
    $writer = Start-WatchHelper "--dump $($root.Id) $created `"$incident`""
    if (-not $writer.WaitForExit(30000)) { throw 'Fixture dump did not finish within 30 seconds.' }
    if ($writer.ExitCode -ne 0) { throw (Get-Content (Join-Path $incident 'status.txt')) }
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

    $notificationLock = [IO.File]::Open((Join-Path $data 'notification.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Write, [IO.FileShare]::None)
    [WatchTestNative]::NtResumeProcess($root.Handle) | Out-Null
    $suspended = $false
    [IO.File]::WriteAllText((Join-Path $fixtures 'allocate'), '')
    Wait-For {
        @((Read-LatestSample).processes | Where-Object { $_.id.pid -eq $root.Id -and $_.private -ge 2147483648 }).Count -eq 1
    } 'Windows private commit threshold'
    Wait-For { Test-Path (Join-Path $data 'incident\process.dmp') } 'automatic threshold capture' 60
    $automatic = Get-Content (Join-Path $data 'incident\report.json') -Raw | ConvertFrom-Json
    if ($automatic.target.pid -ne $root.Id) { throw 'Automatic capture selected the wrong process.' }
    $before = (Read-LatestSample).unixSeconds
    Wait-For { (Read-LatestSample).unixSeconds -gt ($before + 2) } 'monitoring after automatic capture'

    $watcher.Refresh()
    $summary = [ordered]@{
        tree = 'root, child and grandchild found'
        suspendedRoot = 'monitor kept sampling'
        extraProcess = 'registered non-descendant found'
        dump = 'valid full-memory dump of suspended fixture'
        dumpBytes = (Get-Item $dump).Length
        reusedPid = 'rejected'
        automaticCapture = 'real 2 GiB private-commit threshold produced report and dump'
        watcherPrivateBytes = $watcher.PrivateMemorySize64
        watcherWorkingSet = $watcher.WorkingSet64
    }
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
}

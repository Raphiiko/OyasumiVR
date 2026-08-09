// See https://aka.ms/new-console-template for more information

using System.Diagnostics;
using CefSharp;
using CefSharp.OffScreen;
using Serilog;

namespace overlay_sidecar;

public static class Program {
  public static bool GpuAccelerated = true;
  public static SidecarMode Mode = SidecarMode.Release;

  public static void Main(string[] args)
  {
    LogConfigurator.Init();
    var coreGrpcPort = (int)Globals.CORE_GRPC_DEV_PORT;
    var mainProcessId = 0;

    // Parse args
    if (args.Length > 0 && args[0] == "dev")
    {
      Mode = SidecarMode.Dev;
    }

    Log.Information("Starting OyasumiVR overlay sidecar in " + (Mode == SidecarMode.Dev ? "dev" : "release") +
                      " mode.");

    if (Mode == SidecarMode.Release)
    {
      if (!TryParseSwitch(args, "--core-grpc-port", out coreGrpcPort) ||
          !TryParseSwitch(args, "--core-pid", out mainProcessId))
      {
        Log.Error("Usage: oyasumivr-overlay-sidecar.exe --core-grpc-port=<port> --core-pid=<pid>");
        return;
      }
    }

    if (args.Any(arg => arg == "--disable-gpu-acceleration"))
    {
      Log.Information("Launching with GPU acceleration disabled");
      GpuAccelerated = false;
    }

    // Initialize
    WatchMainProcess(mainProcessId);
    InitCef();
    IpcManager.Instance.Init(coreGrpcPort);
    OvrManager.Instance.Init();
  }

  private static bool TryParseSwitch(string[] args, string name, out int value)
  {
    var prefix = name + "=";
    var arg = args.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.Ordinal));
    return int.TryParse(arg?[prefix.Length..], out value);
  }

  private static void InitCef()
  {
    var settings = new CefSettings();

    // CEF 122+ uses the Chrome bootstrap, which requires a unique RootCachePath per running
    // process. When left empty, CEF falls back to the shared default user data directory
    // (%LOCALAPPDATA%\CEF\User Data). That directory is guarded by Chromium's process
    // singleton: if any process still holds it (a lingering previous sidecar instance, or any
    // other CEF-based app using the default path), a newly started sidecar forwards its
    // command line to that process and exits. The receiving process then opens our positional
    // arguments as browser tabs (a bare port number like 24872 gets fixed up to the URL
    // http://0.0.97.40/), and the core sees the exit as a crash and restarts us, repeating the
    // cycle. Each such browser process launch also leaves a ~4MB .pma file in BrowserMetrics,
    // which is never cleaned up because metrics reporting is disabled.
    // See https://github.com/Raphiiko/OyasumiVR/issues/168 (and #166, #165), as well as
    // https://github.com/cefsharp/CefSharp/discussions/4978
    var cacheRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "co.raphii.oyasumi", "cef-cache");
    CleanUpCefCacheDirectories(cacheRoot);
    settings.RootCachePath = Path.Combine(cacheRoot, Environment.ProcessId.ToString());

    // In-memory cache - no disk persistence of browsing data
    settings.CachePath = "";
    settings.PersistSessionCookies = false;
    settings.CefCommandLineArgs.Add("disable-features", "MetricsService,PersistentHistograms");
    settings.CefCommandLineArgs.Add("disable-crash-reporter", "true");
    settings.CefCommandLineArgs.Add("disable-spell-checking", "true");
    
    if (InReleaseMode())
    {
      settings.LogSeverity = LogSeverity.Disable;
      var cefDebugLogPath = Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, @"debug.log");
      if (File.Exists(cefDebugLogPath)) File.Delete(cefDebugLogPath);
    }

    Cef.Initialize(settings);
  }

  private static void CleanUpCefCacheDirectories(string cacheRoot)
  {
    // Remove cache directories left behind by previous sidecar instances. Deleting the cache
    // directory of the running instance at shutdown is unreliable with the Chrome bootstrap
    // (https://github.com/cefsharp/CefSharp/issues/4852), so each launch cleans up after
    // instances that are no longer running instead.
    try
    {
      if (Directory.Exists(cacheRoot))
      {
        foreach (var dir in Directory.GetDirectories(cacheRoot))
        {
          if (int.TryParse(Path.GetFileName(dir), out var pid))
          {
            try
            {
              Process.GetProcessById(pid);
              continue; // Process still exists: leave its cache directory alone
            }
            catch (ArgumentException)
            {
              // Process no longer exists: safe to remove
            }
          }

          try
          {
            Directory.Delete(dir, true);
          }
          catch (Exception e)
          {
            Log.Warning(e, "Could not clean up stale CEF cache directory: {dir}", dir);
          }
        }
      }
    }
    catch (Exception e)
    {
      Log.Warning(e, "Could not clean up stale CEF cache directories");
    }

    // Best-effort cleanup of metrics files that older builds accumulated in CEF's shared
    // default user data directory. Files held open by another process are skipped.
    try
    {
      var legacyMetricsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CEF", "User Data", "BrowserMetrics");
      if (Directory.Exists(legacyMetricsDir))
      {
        foreach (var file in Directory.GetFiles(legacyMetricsDir, "*.pma"))
        {
          try
          {
            File.Delete(file);
          }
          catch (Exception)
          {
            // File is likely in use by another process
          }
        }
      }
    }
    catch (Exception e)
    {
      Log.Warning(e, "Could not clean up legacy CEF browser metrics files");
    }
  }

  private static void WatchMainProcess(int mainPid)
  {
    if (InDevMode()) return;
    Process? mainProcess = null;
    try
    {
      mainProcess = Process.GetProcessById(mainPid);
    }
    catch (ArgumentException)
    {
      Log.Error("Could not find main process to watch (pid=" + mainPid + "). Stopping overlay sidecar.");
      Environment.Exit(1);
      return;
    }

    new Thread(() =>
    {
      while (true)
      {
        if (mainProcess.HasExited)
        {
          Log.Information("Main process has exited. Stopping overlay sidecar.");
          Environment.Exit(0);
          return;
        }

        Thread.Sleep(1000);
      }
    }).Start();
  }

  public static bool InDevMode()
  {
    return Mode == SidecarMode.Dev;
  }

  public static bool InReleaseMode()
  {
    return Mode == SidecarMode.Release;
  }

  public enum SidecarMode {
    Release,
    Dev
  }
}

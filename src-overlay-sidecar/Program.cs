// See https://aka.ms/new-console-template for more information

using System.Diagnostics;
using CefSharp;
using CefSharp.OffScreen;
using Serilog;

namespace overlay_sidecar;

public static class Program {
  public static readonly bool GpuFix = false;
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

    Console.WriteLine("Starting OyasumiVR overlay sidecar in " + (Mode == SidecarMode.Dev ? "dev" : "release") +
                      " mode.");

    if (Mode == SidecarMode.Release)
    {
      if (args.Length < 1 || !int.TryParse(args[0], out coreGrpcPort))
      {
        Console.Error.WriteLine("Usage: overlay-sidecar.exe <core grpc port> <core process id>");
        return;
      }

      if (args.Length < 2 || !int.TryParse(args[1], out mainProcessId))
      {
        Console.Error.WriteLine("Usage: overlay-sidecar.exe <core grpc port> <core process id>");
        return;
      }
    }

    // Initialize
    WatchMainProcess(mainProcessId);
    InitCef();
    IpcManager.Instance.Init(coreGrpcPort);
    OvrManager.Instance.Init();
  }

  private static void InitCef()
  {
    var settings = new CefSettings();
    if (InReleaseMode())
    {
      settings.LogSeverity = LogSeverity.Disable;
      var cefDebugLogPath = Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, @"debug.log");
      if (File.Exists(cefDebugLogPath)) File.Delete(cefDebugLogPath);
    }

    Cef.Initialize(settings);
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

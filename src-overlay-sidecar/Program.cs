// See https://aka.ms/new-console-template for more information

using System.Diagnostics;
using CefSharp;
using CefSharp.OffScreen;
using CefSharp.SchemeHandler;
using Serilog;

namespace overlay_sidecar;

public static class Program {
  public static bool GPUFix = false;

  public static void Main(string[] args)
  {
    LogConfigurator.Init();
    var mainProcessPort = 5176;
    var mainProcessId = 0;

    if (!Debugger.IsAttached)
    {
      // Parse args
      if (args.Length < 1 || !int.TryParse(args[0], out mainProcessPort))
      {
        Console.Error.WriteLine("Usage: overlay-sidecar.exe <main process port> <main process id>");
        return;
      }

      if (args.Length < 2 || !int.TryParse(args[1], out mainProcessId))
      {
        Console.Error.WriteLine("Usage: overlay-sidecar.exe <main process port> <main process id>");
        return;
      }
    }

    // Initialize
    WatchMainProcess(mainProcessId);
    InitCef();
    OvrManager.Instance.Init();
    IpcManager.Instance.Init(mainProcessPort);
  }

  private static void InitCef()
  {
    var settings = new CefSettings();
    if (!Debugger.IsAttached)
    {
      settings.LogSeverity = LogSeverity.Disable;
      var cefDebugLogPath = Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, @"debug.log");
      if (File.Exists(cefDebugLogPath)) File.Delete(cefDebugLogPath);
    }

    Cef.Initialize(settings);
  }

  private static void WatchMainProcess(int mainPid)
  {
    if (Debugger.IsAttached) return;
    Process? mainProcess = null;
    try
    {
      mainProcess = Process.GetProcessById(mainPid);
    }
    catch (ArgumentException)
    {
      Log.Error("Could not find main process to watch (pid=" + mainPid + ")");
      if (!Debugger.IsAttached)
      {
        Log.Information("Quitting...");
        Environment.Exit(1);
        return;
      }
    }

    if (mainProcess == null) return;

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
}

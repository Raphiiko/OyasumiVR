// See https://aka.ms/new-console-template for more information

using System.Diagnostics;
using CefSharp;
using CefSharp.OffScreen;
using CefSharp.SchemeHandler;

namespace overlay_sidecar;

public static class Program {
  public static OVRManager OVRManager;
  public static IPCManager IPCManager;
  public static bool GPUFix = false;

  public static void Main(string[] args)
  {
    Log.Init();

    // Parse args
    if (args.Length < 1 || !int.TryParse(args[0], out var mainProcessPort))
    {
      Console.Error.WriteLine("Usage: overlay-sidecar.exe <main process port> <main process id>");
      return;
    }

    if (args.Length < 2 || !int.TryParse(args[1], out var mainProcessId))
    {
      Console.Error.WriteLine("Usage: overlay-sidecar.exe <main process port> <main process id>");
      return;
    }

    // Initialize
    InitCef();
    WatchMainProcess(mainProcessId);
    OVRManager = new OVRManager();
    IPCManager = new IPCManager(mainProcessPort);
  }

  private static void InitCef()
  {
    Log.Logger.Information("Initializing CEF");
    var rootDir = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(Environment.ProcessPath), @"ui\");
    Directory.CreateDirectory(rootDir);
    var settings = new CefSettings();
    settings.RegisterScheme(new CefCustomScheme
    {
      SchemeName = "oyasumivroverlay",
      DomainName = "ui",
      SchemeHandlerFactory = new FolderSchemeHandlerFactory(
        rootFolder: rootDir,
        hostName: "ui",
        defaultPage: "index.html" // will default to index.html
      )
    });
    Cef.Initialize(settings);
    Log.Logger.Information("Initialized CEF");
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
      Log.Logger.Error("Could not find main process to watch (pid=" + mainPid + ")");
      if (!Debugger.IsAttached)
      {
        Log.Logger.Information("Quitting...");
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
          Log.Logger.Information("Main process has exited. Stopping overlay sidecar.");
          Environment.Exit(0);
          return;
        }
        Thread.Sleep(1000);
      }
    }).Start();
  }
}

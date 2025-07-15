using System.Diagnostics;
using Serilog;
using Serilog.Core;
using Serilog.Filters;

namespace overlay_sidecar;

public static class LogConfigurator {
  private static Logger? _logger;

  public static Logger Logger => _logger!;

  public static void Init()
  {
    var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "co.raphii.oyasumi\\logs\\OyasumiVR_Overlay_Sidecar_.log");
    var config = new LoggerConfiguration()
      .Filter.ByExcluding(Matching.FromSource("Microsoft"))
      .WriteTo.Console()
      .WriteTo.Debug()
      .WriteTo.File(logPath, rollingInterval: RollingInterval.Day, retainedFileTimeLimit: TimeSpan.FromDays(7));
    if (Program.InDevMode())
    {
      config = config.MinimumLevel.Debug();
    }
    else
    {
      config = config.MinimumLevel.Information();
    }

    _logger = config.CreateLogger();

    Log.Logger = _logger;
  }
}

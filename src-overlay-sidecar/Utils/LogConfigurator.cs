using System.Diagnostics;
using Serilog;
using Serilog.Core;
using Serilog.Events;
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
      .Enrich.With<UtcTimestampEnricher>()
      .WriteTo.Console()
      .WriteTo.Debug()
      .WriteTo.File(
        logPath,
        rollingInterval: RollingInterval.Day,
        fileSizeLimitBytes: 1_048_576,
        rollOnFileSizeLimit: true,
        retainedFileCountLimit: 14,
        retainedFileTimeLimit: TimeSpan.FromDays(14),
        outputTemplate: "[{UtcTimestamp:yyyy-MM-dd}][{UtcTimestamp:HH:mm:ss}] [{Level:u}] {Message:lj}{NewLine}{Exception}"
      );
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

  private sealed class UtcTimestampEnricher : ILogEventEnricher
  {
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
      logEvent.AddPropertyIfAbsent(propertyFactory.CreateProperty("UtcTimestamp", logEvent.Timestamp.UtcDateTime));
    }
  }
}

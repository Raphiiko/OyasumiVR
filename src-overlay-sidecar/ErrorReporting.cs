using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Sentry;

namespace overlay_sidecar;

public static class ErrorReporting
{
  private const string Dsn = "https://a08e4e04b7a24cafb5eb6c4ff701e52e@sentry.raphii.co/1";
  private const int FirstEventCap = 20;
  private const int RecurrenceCap = 10;
  private const int IssueCap = 3;
  private const double RecurrenceSampleRate = 0.1;
  private static readonly object Lock = new();
  private static readonly EventBudget Budget = new(Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "co.raphii.oyasumi", "error-reporting-overlay-sidecar.json"));
  private static readonly Regex[] SensitivePatterns = [
    new(@"\bauthorization\s*[:=]\s*\S+(?:\s+\S+)?", RegexOptions.IgnoreCase),
    new(@"\bbearer\s+\S+", RegexOptions.IgnoreCase),
    new(@"(token|password|secret|api[_-]?key)\s*[:=]?\s*\S+", RegexOptions.IgnoreCase),
    new(@"\b(user(name)?|display\s*name|account\s*id)\s*[:=]\s*\S+", RegexOptions.IgnoreCase),
    new("\"(?:[a-z]:[\\\\/]|\\\\\\\\)[^\"\\r\\n]+\"", RegexOptions.IgnoreCase),
    new(@"\b[a-z]:[\\/][^\r\n]+", RegexOptions.IgnoreCase),
    new(@"\\\\[^\s\r\n]+"),
    new(@"file:///\S+", RegexOptions.IgnoreCase),
    new(@"https?://\S+", RegexOptions.IgnoreCase),
    new(@"\b(device\s*)?serial(\s*number)?\s*[:=]\s*\S+", RegexOptions.IgnoreCase),
    new(@"\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b", RegexOptions.IgnoreCase),
    new(@"\b(?:usr|auth|file|avtr|wrld|grp)_[a-z0-9-]+\b", RegexOptions.IgnoreCase),
    new(@"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b", RegexOptions.IgnoreCase),
    new(@"\b\d{8,}\b")
  ];
  private static IDisposable? _guard;
  private static bool _enabled;
  private static string _version = "unknown";

  public static void Initialize(bool enabled, string version)
  {
    _version = version;
    SetEnabled(enabled);
  }

  public static void SetEnabled(bool enabled)
  {
    enabled = enabled && !Program.InDevMode() && !IsDebugBuild;
    lock (Lock)
    {
      Volatile.Write(ref _enabled, enabled);
      if (!enabled || _guard != null) return;
      try
      {
        _guard = SentrySdk.Init(options =>
        {
          options.Dsn = Dsn;
          options.Release = _version;
          options.Environment = "production";
          options.IsGlobalModeEnabled = true;
          options.SendDefaultPii = false;
          options.MaxBreadcrumbs = 0;
          options.MaxQueueItems = 2;
          options.ShutdownTimeout = TimeSpan.FromSeconds(1);
          options.CacheDirectoryPath = null;
          options.DisableFileWrite = true;
          options.SendClientReports = false;
          options.AutoSessionTracking = false;
          options.EnableLogs = false;
          options.EnableMetrics = false;
          options.TracesSampleRate = 0;
          options.ProfilesSampleRate = 0;
          options.CaptureFailedRequests = false;
          options.DisableDiagnosticSourceIntegration();
          options.DisableSystemDiagnosticsMetricsIntegration();
          options.SetBeforeBreadcrumb(_ => null);
          options.SetBeforeSend(FilterAndSanitize);
        });
      }
      catch
      {
        Volatile.Write(ref _enabled, false);
        _guard = null;
      }
    }
  }

  private static SentryEvent? FilterAndSanitize(SentryEvent sentryEvent)
  {
    try
    {
      if (!Volatile.Read(ref _enabled) || IsCancellation(sentryEvent.Exception)) return null;
      Sanitize(sentryEvent);
      return Budget.Allow(IssueKey(sentryEvent)) ? sentryEvent : null;
    }
    catch
    {
      return null;
    }
  }

  private static bool IsCancellation(Exception? exception)
  {
    if (exception is OperationCanceledException) return true;
    return exception is AggregateException aggregate && aggregate.InnerExceptions.All(IsCancellation);
  }

  private static void Sanitize(SentryEvent sentryEvent)
  {
    sentryEvent.User = null!;
    sentryEvent.Request = null!;
    sentryEvent.ServerName = null;
    sentryEvent.Logger = null;
    sentryEvent.TransactionName = null;
    if (sentryEvent.Extra is IDictionary<string, object?> extra) extra.Clear();
    sentryEvent.Modules.Clear();
    if (sentryEvent.Breadcrumbs is ICollection<Breadcrumb> breadcrumbs) breadcrumbs.Clear();
    sentryEvent.Contexts.Clear();
    foreach (var tag in sentryEvent.Tags.Keys.ToArray()) sentryEvent.UnsetTag(tag);
    sentryEvent.SetTag("app_version", _version);
    sentryEvent.SetTag("component", "overlay");
    sentryEvent.SetTag("platform", "windows");
    sentryEvent.SetTag("runtime", $".NET {Environment.Version.Major}.{Environment.Version.Minor}");
    if (sentryEvent.Message != null)
    {
      var message = SanitizeText(sentryEvent.Message.Formatted ?? sentryEvent.Message.Message);
      sentryEvent.Message = new SentryMessage { Message = message, Formatted = message };
    }
    foreach (var exception in sentryEvent.SentryExceptions ?? [])
    {
      exception.Value = SanitizeText(exception.Value);
      exception.Module = null;
      if (exception.Mechanism != null)
      {
        exception.Mechanism.Description = null;
        exception.Mechanism.HelpLink = null;
        exception.Mechanism.Data.Clear();
      }
      if (exception.Stacktrace == null) continue;
      foreach (var frame in exception.Stacktrace.Frames)
      {
        frame.AbsolutePath = null;
        frame.Package = null;
        frame.Vars.Clear();
        frame.PreContext.Clear();
        frame.ContextLine = null;
        frame.PostContext.Clear();
        if (frame.FileName != null) frame.FileName = Path.GetFileName(frame.FileName);
      }
    }
  }

  private static string IssueKey(SentryEvent sentryEvent)
  {
    var exception = sentryEvent.SentryExceptions?.FirstOrDefault();
    var frame = exception?.Stacktrace?.Frames.LastOrDefault();
    var message = exception?.Value ?? sentryEvent.Message?.Formatted ?? sentryEvent.Message?.Message;
    var raw = $"{exception?.Type}:{message}:{frame?.Module}:{frame?.Function}";
    return raw;
  }

  private static string SanitizeText(string? value)
  {
    var result = value ?? "";
    foreach (var pattern in SensitivePatterns) result = pattern.Replace(result, "[redacted]");
    return result[..Math.Min(result.Length, 512)];
  }

  private static bool IsDebugBuild
  {
    get
    {
#if DEBUG
      return true;
#else
      return false;
#endif
    }
  }

  private sealed class EventBudget(string path)
  {
    private readonly object _lock = new();
    private BudgetState _state = Load(path);

    public bool Allow(string issue)
    {
      lock (_lock)
      {
        var day = CurrentDay();
        if (_state.Day != day) _state = new BudgetState { Day = day };
        var previous = _state.Clone();
        issue = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(issue)));
        _state.Issues.TryGetValue(issue, out var occurrences);
        if (occurrences == 0)
        {
          if (_state.FirstEvents >= FirstEventCap) return false;
          _state.FirstEvents++;
        }
        else
        {
          if (occurrences >= IssueCap || _state.RecurrenceEvents >= RecurrenceCap ||
              Random.Shared.NextDouble() >= RecurrenceSampleRate) return false;
          _state.RecurrenceEvents++;
        }
        _state.Issues[issue] = occurrences + 1;
        if (Persist(path, _state)) return true;
        _state = previous;
        return false;
      }
    }

    private static BudgetState Load(string path)
    {
      try
      {
        var state = JsonSerializer.Deserialize<BudgetState>(File.ReadAllText(path));
        if (state?.Day == CurrentDay()) return state;
      }
      catch
      {
      }
      return new BudgetState { Day = CurrentDay() };
    }

    private static bool Persist(string path, BudgetState state)
    {
      try
      {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state));
        File.Move(temporary, path, true);
        return true;
      }
      catch
      {
        return false;
      }
    }

    private static long CurrentDay()
    {
      return DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 86_400;
    }
  }

  private sealed class BudgetState
  {
    public long Day { get; set; }
    public int FirstEvents { get; set; }
    public int RecurrenceEvents { get; set; }
    public Dictionary<string, int> Issues { get; set; } = [];

    public BudgetState Clone()
    {
      return new BudgetState
      {
        Day = Day,
        FirstEvents = FirstEvents,
        RecurrenceEvents = RecurrenceEvents,
        Issues = new Dictionary<string, int>(Issues)
      };
    }
  }
}

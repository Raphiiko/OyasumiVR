using CefSharp;
using overlay_sidecar.Browsers;
using Serilog;

namespace overlay_sidecar;

public class BrowserManager {
  public static BrowserManager Instance { get; } = new();
  private List<CachedBrowser> _browsers = new();

  private BrowserManager()
  {
  }

  public void PreInitializeBrowser(uint width, uint height)
  {
    FreeBrowser(GetBrowser("about:blank", width, height));
  }

  public OffscreenBrowser GetBrowser(string url, uint width, uint height)
  {
    lock (_browsers)
    {
      foreach (var cachedBrowser in _browsers)
      {
        if (cachedBrowser.IsFree && cachedBrowser.Width == width && cachedBrowser.Height == height)
        {
          cachedBrowser.IsFree = false;
          cachedBrowser.Browser.LoadUrl(url);
          return cachedBrowser.Browser;
        }
      }

      OffscreenBrowser browser = Program.GpuAccelerated ? new AcceleratedOffscreenBrowser(url, width, height) : new NonAcceleratedOffscreenBrowser(url, width, height);
      if (Program.InDevMode()) LogBrowserEvents(browser);
      _browsers.Add(new CachedBrowser(browser, false, width, height));

      return browser;
    }
  }

  public void FreeBrowser(OffscreenBrowser browser)
  {
    lock (_browsers)
    {
      foreach (var cachedBrowser in _browsers)
      {
        if (cachedBrowser.Browser == browser)
        {
          cachedBrowser.Browser.JavascriptObjectRepository.UnRegisterAll();
          cachedBrowser.Browser.LoadHtml("");
          cachedBrowser.IsFree = true;
          return;
        }
      }
    }
  }

  // Browsers are pooled and reused across overlays, so the current address identifies the overlay.
  private static void LogBrowserEvents(OffscreenBrowser browser)
  {
    browser.ConsoleMessage += (_, e) =>
      Log.Information("[Browser {address}] {level} {message} ({source}:{line})", browser.Address, e.Level,
        e.Message, e.Source, e.Line);
    browser.LoadError += (_, e) =>
      Log.Error("[Browser {address}] Failed to load {url}: {error} ({text})", browser.Address, e.FailedUrl,
        e.ErrorCode, e.ErrorText);
    browser.LoadingStateChanged += (_, e) =>
      Log.Information("[Browser {address}] Loading={loading}", browser.Address, e.IsLoading);
  }

  class CachedBrowser {
    public OffscreenBrowser Browser;
    public bool IsFree;
    public uint Width;
    public uint Height;

    public CachedBrowser(OffscreenBrowser browser, bool isFree, uint width, uint height)
    {
      Browser = browser;
      IsFree = isFree;
      Width = width;
      Height = height;
    }
  }
}

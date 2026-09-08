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
          try { cachedBrowser.Browser.LoadUrl(url); }
          catch
          {
            _browsers.Remove(cachedBrowser);
            cachedBrowser.Browser.Dispose();
            throw;
          }
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
      var cached = _browsers.Find(entry => entry.Browser == browser);
      if (cached == null || cached.IsFree) return;
      browser.SetTextureTarget(null);
      browser.JavascriptObjectRepository.UnRegisterAll();
      if (_browsers.Any(entry => entry.IsFree && entry.Width == cached.Width && entry.Height == cached.Height))
      {
        _browsers.Remove(cached);
        browser.Dispose();
        return;
      }
      try
      {
        browser.LoadHtml("");
        cached.IsFree = true;
      }
      catch
      {
        _browsers.Remove(cached);
        browser.Dispose();
        throw;
      }
    }
  }

  public void DisposeAll()
  {
    lock (_browsers)
    {
      foreach (var cached in _browsers)
      {
        try { cached.Browser.Dispose(); }
        catch (Exception error) { Log.Error(error, "Could not dispose a browser during shutdown."); }
      }
      _browsers.Clear();
    }
  }

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

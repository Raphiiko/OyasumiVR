using CefSharp;

namespace overlay_sidecar;

public class BrowserManager {
  public static BrowserManager Instance { get; } = new();
  private List<CachedBrowser> _browsers = new();

  private BrowserManager()
  {
  }

  public OffScreenBrowser GetBrowser(string url, int width, int height)
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

      var browser = new OffScreenBrowser(url, width, height);
      _browsers.Add(new CachedBrowser(browser, false, width, height));

      return browser;
    }
  }

  public void FreeBrowser(OffScreenBrowser browser)
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

  class CachedBrowser {
    public OffScreenBrowser Browser;
    public bool IsFree;
    public int Width;
    public int Height;

    public CachedBrowser(OffScreenBrowser browser, bool isFree, int width, int height)
    {
      Browser = browser;
      IsFree = isFree;
      Width = width;
      Height = height;
    }
  }
}

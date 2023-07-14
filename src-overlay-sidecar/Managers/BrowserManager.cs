using CefSharp;

namespace overlay_sidecar;

public class BrowserManager {
  public static BrowserManager Instance { get; } = new();
  private List<CachedBrowser> _browsers = new();

  private BrowserManager()
  {
  }

  public OffScreenBrowser GetBrowser(String url, int width, int height)
  {
    lock (_browsers)
    {
      foreach (var cachedBrowser in _browsers)
      {
        if (cachedBrowser.IsFree && cachedBrowser.width == width && cachedBrowser.height == height)
        {
          cachedBrowser.IsFree = false;
          cachedBrowser.Browser.LoadUrl(url);
          return cachedBrowser.Browser;
        }
      }

      var browser = new OffScreenBrowser(url, width, height);
      _browsers.Add(new CachedBrowser { Browser = browser, IsFree = false, width = width, height = height });

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
    public int width;
    public int height;
  }
}

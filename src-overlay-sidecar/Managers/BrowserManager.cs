using CefSharp;
using overlay_sidecar.Browsers;

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

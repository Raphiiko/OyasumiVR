using CefSharp;
using CefSharp.OffScreen;
using CefSharp.Web;
using SharpDX.Direct3D11;

namespace overlay_sidecar.Browsers;

public abstract class OffscreenBrowser : ChromiumWebBrowser
{
  protected long _lastPaint;
  public long LastPaint => _lastPaint;

  protected OffscreenBrowser(HtmlString html, IBrowserSettings browserSettings = null, IRequestContext requestContext = null, bool automaticallyCreateBrowser = true, Action<IBrowser> onAfterBrowserCreated = null, bool useLegacyRenderHandler = true) : base(html, browserSettings, requestContext, automaticallyCreateBrowser, onAfterBrowserCreated, useLegacyRenderHandler)
  {
  }

  protected OffscreenBrowser(string address = "", IBrowserSettings browserSettings = null, IRequestContext requestContext = null, bool automaticallyCreateBrowser = true, Action<IBrowser> onAfterBrowserCreated = null, bool useLegacyRenderHandler = true) : base(address, browserSettings, requestContext, automaticallyCreateBrowser, onAfterBrowserCreated, useLegacyRenderHandler)
  {
  }

  public abstract void SetTextureTarget(Texture2D? renderTarget);

  public abstract void Render();
}

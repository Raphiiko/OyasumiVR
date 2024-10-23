// Source: https://github.com/vrcx-team/VRCX/blob/master/OffScreenBrowser.cs

using SharpDX.Mathematics.Interop;

namespace overlay_sidecar;

using CefSharp;
using CefSharp.Enums;
using CefSharp.OffScreen;
using CefSharp.Structs;
using SharpDX.Direct3D11;
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class OffScreenBrowser : ChromiumWebBrowser, IRenderHandler {
  private Texture2D? _texture;
  private long _lastPaint;
  public long LastPaint => _lastPaint;

  public OffScreenBrowser(string address, int width, int height)
    : base(
      address,
      automaticallyCreateBrowser: false
    )
  {
    var windowInfo = new WindowInfo();
    windowInfo.SetAsWindowless(IntPtr.Zero);
    windowInfo.WindowlessRenderingEnabled = true;
    windowInfo.SharedTextureEnabled = true;
    windowInfo.Width = width;
    windowInfo.Height = height;

    var browserSettings = new BrowserSettings()
    {
      WindowlessFrameRate = 60,
      WebGl = CefState.Enabled,
      DefaultEncoding = "UTF-8"
    };

    CreateBrowser(windowInfo, browserSettings);

    Size = new System.Drawing.Size(width, height);
    RenderHandler = this;
  }

  public new void Dispose()
  {
    RenderHandler = null;
    if (IsDisposed) return;
    base.Dispose();
  }

  public void UpdateTexture(Texture2D texture)
  {
    _texture = texture;
  }

  ScreenInfo? IRenderHandler.GetScreenInfo()
  {
    return new ScreenInfo
    {
      DeviceScaleFactor = 1.0F
    };
  }

  bool IRenderHandler.GetScreenPoint(int viewX, int viewY, out int screenX, out int screenY)
  {
    screenX = viewX;
    screenY = viewY;
    return false;
  }

  Rect IRenderHandler.GetViewRect()
  {
    return new Rect(0, 0, Size.Width, Size.Height);
  }

  void IRenderHandler.OnAcceleratedPaint(PaintElementType type, Rect dirtyRect, AcceleratedPaintInfo paintInfo)
  {
    if (type != PaintElementType.View) return;
    if (OvrManager.Instance.D3D11Device1 == null) return;
    if (_texture == null) return;

    using var cefTexture =
      OvrManager.Instance.D3D11Device1.OpenSharedResource1<Texture2D>(paintInfo.SharedTextureHandle);
    var context = OvrManager.Instance.D3D11Device.ImmediateContext;
    context.CopyResource(cefTexture, _texture);

    Query query = OvrManager.Instance.D3D11Query;
    context.End(query);
    context.Flush();

    RawBool q = context.GetData<RawBool>(query, AsynchronousFlags.DoNotFlush);

    while (!q)
    {
      Thread.Yield();
      q = context.GetData<RawBool>(query, AsynchronousFlags.DoNotFlush);
    }

    _lastPaint = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  }

  void IRenderHandler.OnCursorChange(IntPtr cursor, CursorType type, CursorInfo customCursorInfo)
  {
  }

  void IRenderHandler.OnImeCompositionRangeChanged(CefSharp.Structs.Range selectedRange, Rect[] characterBounds)
  {
  }

  void IRenderHandler.OnPaint(PaintElementType type, Rect dirtyRect, IntPtr buffer, int width, int height)
  {
  }

  void IRenderHandler.OnPopupShow(bool show)
  {
  }

  void IRenderHandler.OnPopupSize(Rect rect)
  {
  }

  void IRenderHandler.OnVirtualKeyboardRequested(IBrowser browser, TextInputMode inputMode)
  {
  }

  bool IRenderHandler.StartDragging(IDragData dragData, DragOperationsMask mask, int x, int y)
  {
    return false;
  }

  void IRenderHandler.UpdateDragCursor(DragOperationsMask operation)
  {
  }
}

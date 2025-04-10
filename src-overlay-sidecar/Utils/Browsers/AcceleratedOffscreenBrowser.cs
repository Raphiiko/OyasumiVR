// Based on:
// https://github.com/vrcx-team/VRCX/blob/master/Dotnet/Overlay/OffScreenBrowser.cs

using overlay_sidecar.Browsers;
using Serilog;
using SharpDX.Direct3D;
using SharpDX.Mathematics.Interop;

namespace overlay_sidecar;

using CefSharp;
using CefSharp.Enums;
using CefSharp.OffScreen;
using CefSharp.Structs;
using SharpDX.Direct3D11;
using System;
using System.Threading;

public class AcceleratedOffscreenBrowser : OffscreenBrowser, IRenderHandler
{
  private Device? _device;
  private Device1? _device1;
  private DeviceMultithread? _deviceMultithread;
  private Query? _query;
  private Texture2D? _renderTarget;

  public AcceleratedOffscreenBrowser(string address, uint width, uint height)
    : base(
      address,
      automaticallyCreateBrowser: false
    )
  {
    var windowInfo = new WindowInfo();
    windowInfo.SetAsWindowless(IntPtr.Zero);
    windowInfo.WindowlessRenderingEnabled = true;
    windowInfo.SharedTextureEnabled = true;
    windowInfo.Width = (int)width;
    windowInfo.Height = (int)height;

    var browserSettings = new BrowserSettings()
    {
      WindowlessFrameRate = 60,
      DefaultEncoding = "UTF-8"
    };

    CreateBrowser(windowInfo, browserSettings);

    Size = new System.Drawing.Size((int)width, (int)height);
    RenderHandler = this;
  }

  public new void Dispose()
  {
    RenderHandler = null;
    if (IsDisposed) return;
    base.Dispose();
  }

  public override void SetTextureTarget(Texture2D? renderTarget)
  {
    if (renderTarget == null)
    {
      _device?.Dispose();
      _device = null;
      _device1?.Dispose();
      _device1 = null;
      _deviceMultithread?.Dispose();
      _deviceMultithread = null;
      _renderTarget = null;
      return;
    }

    _device = renderTarget.Device;
    _device1 = _device.QueryInterface<Device1>();

    _deviceMultithread?.Dispose();
    _deviceMultithread = _device.QueryInterfaceOrNull<DeviceMultithread>();
    _deviceMultithread?.SetMultithreadProtected(true);

    _renderTarget = renderTarget;

    _query?.Dispose();
    _query = new Query(_device, new QueryDescription
    {
      Type = QueryType.Event,
      Flags = QueryFlags.None
    });
  }

  public override void Render()
  {
    // No need to render anything here, as the texture is shared
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
    if (type != PaintElementType.View)
      return;

    if (_device == null || _device1 == null)
      return;

    try
    {
      using Texture2D cefTexture = _device1.OpenSharedResource1<Texture2D>(paintInfo.SharedTextureHandle);
      _device.ImmediateContext.CopyResource(cefTexture, _renderTarget);
      _device.ImmediateContext.End(_query);
      _device.ImmediateContext.Flush();
    }
    catch (Exception e)
    {
      Log.Warning("Could not copy texture: " + e);
      _device = null;
      return;
    }

    RawBool q = _device.ImmediateContext.GetData<RawBool>(_query, AsynchronousFlags.DoNotFlush);

    while (!q)
    {
      Thread.Yield();
      q = _device.ImmediateContext.GetData<RawBool>(_query, AsynchronousFlags.DoNotFlush);
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

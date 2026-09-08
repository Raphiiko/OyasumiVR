using System.Diagnostics;
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
  private readonly object _textureLock = new();
  private bool _stopped;
  private bool _copyFailed;
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
    using var windowInfo = new WindowInfo();
    windowInfo.SetAsWindowless(IntPtr.Zero);
    windowInfo.WindowlessRenderingEnabled = true;
    windowInfo.SharedTextureEnabled = true;
    windowInfo.Width = (int)width;
    windowInfo.Height = (int)height;

    using var browserSettings = new BrowserSettings()
    {
      WindowlessFrameRate = 60,
      DefaultEncoding = "UTF-8"
    };

    CreateBrowser(windowInfo, browserSettings);

    Size = new System.Drawing.Size((int)width, (int)height);
    RenderHandler = this;
  }

  protected override void Dispose(bool disposing)
  {
    if (disposing)
    {
      RenderHandler = null;
      lock (_textureLock)
      {
        _stopped = true;
        SetTextureTarget(null);
      }
    }
    base.Dispose(disposing);
  }

  public override void SetTextureTarget(Texture2D? renderTarget)
  {
    lock (_textureLock)
    {
      ReleaseTextureTarget();
      if (renderTarget == null || _stopped || IsDisposed) return;
      try
      {
        _device = renderTarget.Device.QueryInterface<Device>();
        _device1 = _device.QueryInterface<Device1>();
        _deviceMultithread = _device.QueryInterfaceOrNull<DeviceMultithread>();
        _deviceMultithread?.SetMultithreadProtected(true);
        _query = new Query(_device, new QueryDescription
        {
          Type = QueryType.Event,
          Flags = QueryFlags.None
        });
        _renderTarget = renderTarget;
      }
      catch
      {
        ReleaseTextureTarget();
        throw;
      }
    }
  }

  private void ReleaseTextureTarget()
  {
    _renderTarget = null;
    _lastPaint = 0;
    _copyFailed = false;
    _query?.Dispose();
    _query = null;
    _deviceMultithread?.Dispose();
    _deviceMultithread = null;
    _device1?.Dispose();
    _device1 = null;
    _device?.Dispose();
    _device = null;
  }

  public override void Render()
  {
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
    lock (_textureLock)
    {
      if (_device == null || _renderTarget == null) return;
      try
      {
        using var cefTexture = _device1!.OpenSharedResource1<Texture2D>(paintInfo.SharedTextureHandle);
        var context = _device.ImmediateContext;
        context.CopyResource(cefTexture, _renderTarget);
        context.End(_query);
        context.Flush();
        var started = Stopwatch.GetTimestamp();
        while (!context.GetData<RawBool>(_query, AsynchronousFlags.DoNotFlush))
        {
          _device.DeviceRemovedReason.CheckError();
          if (Stopwatch.GetElapsedTime(started) >= TimeSpan.FromMilliseconds(250))
            throw new TimeoutException("The overlay GPU copy did not finish within 250 ms.");
          Thread.Sleep(1);
        }
        _lastPaint = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _copyFailed = false;
      }
      catch (Exception e)
      {
        _lastPaint = 0;
        if (!_copyFailed)
          Log.Error(e, "Could not copy Chromium's shared texture. Later paints will retry; disable GPU acceleration if this persists.");
        _copyFailed = true;
      }
    }
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

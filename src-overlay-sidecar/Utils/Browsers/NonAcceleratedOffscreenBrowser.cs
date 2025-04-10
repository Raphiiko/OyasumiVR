// Based on:
// https://github.com/vrcx-team/VRCX/blob/master/Dotnet/Overlay/OffScreenBrowserLegacy.cs

using System.Runtime.InteropServices;
using overlay_sidecar.Browsers;

namespace overlay_sidecar;

using CefSharp;
using CefSharp.Enums;
using CefSharp.OffScreen;
using CefSharp.Structs;
using SharpDX.Direct3D11;
using System;
using System.Threading;

public class NonAcceleratedOffscreenBrowser : OffscreenBrowser, IRenderHandler
{
  private readonly ReaderWriterLockSlim _paintBufferLock;
  private GCHandle _paintBuffer;
  private int _width;
  private int _height;
  private Texture2D? _renderTarget;

  public NonAcceleratedOffscreenBrowser(string address, uint width, uint height)
    : base(
      address,
      new BrowserSettings()
      {
        DefaultEncoding = "UTF-8"
      }
    )
  {
    _paintBufferLock = new ReaderWriterLockSlim();

    Size = new System.Drawing.Size((int)width, (int)height);
    RenderHandler = this;
  }

  public new void Dispose()
  {
    RenderHandler = null;
    base.Dispose();

    _paintBufferLock.EnterWriteLock();
    try
    {
      if (_paintBuffer.IsAllocated)
      {
        _paintBuffer.Free();
      }
    }
    finally
    {
      _paintBufferLock.ExitWriteLock();
    }

    _paintBufferLock.Dispose();
  }

  public override void SetTextureTarget(Texture2D? renderTarget)
  {
    _renderTarget = renderTarget;
  }

  public override void Render()
  {
    // Safeguard against uninitialized texture
    if (_renderTarget == null)
      return;

    _paintBufferLock.EnterReadLock();
    try
    {
      if (_width > 0 &&
          _height > 0)
      {
        var context = _renderTarget.Device.ImmediateContext;
        var dataBox = context.MapSubresource(
          _renderTarget,
          0,
          MapMode.WriteDiscard,
          MapFlags.None
        );
        if (dataBox.IsEmpty == false)
        {
          var sourcePtr = _paintBuffer.AddrOfPinnedObject();
          var destinationPtr = dataBox.DataPointer;
          var pitch = _width * 4;
          var rowPitch = dataBox.RowPitch;
          if (pitch == rowPitch)
          {
            WinApi.RtlCopyMemory(
              destinationPtr,
              sourcePtr,
              (uint)(_width * _height * 4)
            );
          }
          else
          {
            for (var y = _height; y > 0; --y)
            {
              WinApi.RtlCopyMemory(
                destinationPtr,
                sourcePtr,
                (uint)pitch
              );
              sourcePtr += pitch;
              destinationPtr += rowPitch;
            }
          }
        }

        context.UnmapSubresource(_renderTarget, 0);
      }
    }
    finally
    {
      _paintBufferLock.ExitReadLock();
      _lastPaint = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
  }

  ScreenInfo? IRenderHandler.GetScreenInfo()
  {
    return null;
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
  }

  void IRenderHandler.OnCursorChange(IntPtr cursor, CursorType type, CursorInfo customCursorInfo)
  {
  }

  void IRenderHandler.OnImeCompositionRangeChanged(CefSharp.Structs.Range selectedRange, Rect[] characterBounds)
  {
  }

  void IRenderHandler.OnPaint(PaintElementType type, Rect dirtyRect, IntPtr buffer, int width, int height)
  {
    if (type == PaintElementType.View)
    {
      _paintBufferLock.EnterWriteLock();
      try
      {
        if (_width != width ||
            _height != height)
        {
          _width = width;
          _height = height;
          if (_paintBuffer.IsAllocated == true)
          {
            _paintBuffer.Free();
          }

          _paintBuffer = GCHandle.Alloc(
            new byte[_width * _height * 4],
            GCHandleType.Pinned
          );
        }

        WinApi.RtlCopyMemory(
          _paintBuffer.AddrOfPinnedObject(),
          buffer,
          (uint)(width * height * 4)
        );
      }
      finally
      {
        _paintBufferLock.ExitWriteLock();
      }
    }
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

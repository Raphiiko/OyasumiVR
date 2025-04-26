using System.Runtime.InteropServices;
using Serilog;
using SharpDX.Direct3D11;
using Valve.VR;

namespace overlay_sidecar;

public class TextureWriter
{
  private readonly ReaderWriterLockSlim _paintBufferLock;
  private GCHandle _paintBuffer;

  private Texture2D? _texture;
  private uint _resolution;
  private bool _initialized;

  public TextureWriter(uint resolution)
  {
    _resolution = resolution;
    _paintBufferLock = new ReaderWriterLockSlim();
    _paintBuffer = GCHandle.Alloc(
      new byte[resolution * resolution * 4],
      GCHandleType.Pinned
    );
  }

  public Texture_t AsTextureT()
  {
    return new Texture_t
    {
      handle = _texture!.NativePointer,
    };
  }

  public void WriteBufferToTexture()
  {
    _paintBufferLock.EnterReadLock();
    try
    {
      var context = _texture.Device.ImmediateContext;
      var dataBox = context.MapSubresource(
        _texture,
        0,
        MapMode.WriteDiscard,
        MapFlags.None
      );
      if (dataBox.IsEmpty == false)
      {
        var sourcePtr = _paintBuffer.AddrOfPinnedObject();
        var destinationPtr = dataBox.DataPointer;
        var pitch = _resolution * 4;
        var rowPitch = dataBox.RowPitch;
        if (pitch == rowPitch)
        {
          WinApi.RtlMoveMemory(
            destinationPtr,
            sourcePtr,
            _resolution * _resolution * 4
          );
        }
        else
        {
          for (var y = _resolution; y > 0; --y)
          {
            WinApi.RtlMoveMemory(
              destinationPtr,
              sourcePtr,
              pitch
            );
            sourcePtr = new IntPtr(sourcePtr.ToInt64() + pitch);
            destinationPtr = new IntPtr(destinationPtr.ToInt64() + rowPitch);
          }
        }
      }

      context.UnmapSubresource(_texture, 0);
    }
    finally
    {
      _paintBufferLock.ExitReadLock();
    }
  }

  public void WriteImageToBuffer(byte[] data)
  {
    if (!_initialized) return;
    _paintBufferLock.EnterWriteLock();
    GCHandle dataHandle = GCHandle.Alloc(data, GCHandleType.Pinned);
    try
    {
      if (_paintBuffer.IsAllocated)
      {
        var paintBufferPtr = _paintBuffer.AddrOfPinnedObject();
        var dataPtr = dataHandle.AddrOfPinnedObject();
        WinApi.RtlMoveMemory(paintBufferPtr, dataPtr, _resolution * _resolution * 4);
      }
      else
      {
        Log.Warning("[TextureWriter] Paint buffer is not allocated");
      }
    }
    finally
    {
      _paintBufferLock.ExitWriteLock();
      dataHandle.Free();
    }
  }

  public async Task init()
  {
    try
    {
      _texture = await Utils.InitTexture2D(_resolution, true);
    }
    catch
    {
      Dispose();
      throw;
    }

    _initialized = true;
  }

  public void Dispose()
  {
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

    if (_texture != null && !_texture.IsDisposed)
    {
      _texture.Dispose();
      _texture = null;
    }
  }
}

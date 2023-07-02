using System.Diagnostics;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Valve.VR;
using Device = SharpDX.Direct3D11.Device;

namespace overlay_sidecar;

public class BaseOverlay {
  protected bool UiReady;
  protected readonly ulong? overlayHandle;
  protected readonly OffScreenBrowser browser;
  protected readonly Texture2D texture;
  protected readonly Device device;
  protected bool Disposed;

  public ulong OverlayHandle => overlayHandle!.Value;
  public OffScreenBrowser Browser => browser;

  protected BaseOverlay(string path, int resolution, string overlayKey, string overlayName)
  {
    var uiUrl = Debugger.IsAttached ? "http://localhost:5173" + path : "oyasumivroverlay://ui" + path;
    browser = new OffScreenBrowser(uiUrl, resolution, resolution);
    device = Program.GPUFix
      ? new Device(new Factory1().GetAdapter(1), DeviceCreationFlags.BgraSupport)
      : new Device(DriverType.Hardware, DeviceCreationFlags.SingleThreaded | DeviceCreationFlags.BgraSupport);
    texture = new Texture2D(
      device,
      new Texture2DDescription
      {
        Width = resolution,
        Height = resolution,
        MipLevels = 1,
        ArraySize = 1,
        Format = Format.B8G8R8A8_UNorm,
        SampleDescription = new SampleDescription(1, 0),
        Usage = ResourceUsage.Dynamic,
        BindFlags = BindFlags.ShaderResource,
        CpuAccessFlags = CpuAccessFlags.Write
      }
    );
    browser.JavascriptObjectRepository.Register("OyasumiIPCOut", this);
    ulong overlayHandle = 0;
    {
      var err = OpenVR.Overlay.CreateOverlay(overlayKey, overlayName, ref overlayHandle);
      if (err != EVROverlayError.None)
      {
        Log.Logger.Error("Could not create overlay: " + err);
        Dispose();
        return;
      }
    }
    this.overlayHandle = overlayHandle;
    new Thread(() =>
    {
      var timer = new RefreshRateTimer();
      while (!Disposed)
      {
        timer.tickStart();
        UpdateFrame();
        timer.sleepUntilNextTick();
      }
    }).Start();
  }

  public void Dispose()
  {
    Disposed = true;
    browser?.Dispose();
    texture?.Dispose();
    device?.Dispose();
    if (overlayHandle.HasValue) OpenVR.Overlay.DestroyOverlay(overlayHandle!.Value);
  }

  public void OnUiReady()
  {
    UiReady = true;
  }

  public void SetSleepMode(bool enabled)
  {
  }

  private void UpdateFrame()
  {
    if (Disposed || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - browser.LastPaint >= 1000) return;
    browser.RenderToTexture(this.texture);
    var texture = new Texture_t
    {
      handle = this.texture.NativePointer
    };
    var err = OpenVR.Overlay.SetOverlayTexture(overlayHandle!.Value, ref texture);
    if (err != EVROverlayError.None) Console.WriteLine("Could not set overlay texture.");
  }
}

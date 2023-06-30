using System.Diagnostics;
using OVRSharp;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Valve.VR;
using Device = SharpDX.Direct3D11.Device;

namespace overlay_sidecar;

public class BaseOverlay {
  protected bool UiReady;
  protected readonly Overlay overlay;
  protected readonly OffScreenBrowser browser;
  protected readonly Texture2D texture;
  protected readonly Device device;
  protected bool Disposed;

  public Overlay Overlay => overlay;
  public OffScreenBrowser Browser => browser;

  protected BaseOverlay(String path, int resolution, String overlayKey, String overlayName)
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
    overlay = new Overlay(overlayKey, overlayName);
    new Thread(() =>
    {
      while (!Disposed)
      {
        Thread.Sleep(11);
        UpdateFrame();
      }
    }).Start();
  }

  public void Dispose()
  {
    Disposed = true;
    browser?.Dispose();
    texture?.Dispose();
    device?.Dispose();
    overlay?.Destroy();
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
    if (Disposed || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - browser.LastPaint > 1000) return;
    browser.RenderToTexture(this.texture);
    var texture = new Texture_t
    {
      handle = this.texture.NativePointer
    };
    var err = OpenVR.Overlay.SetOverlayTexture(this.overlay.Handle, ref texture);
    if (err != EVROverlayError.None)
    {
      Console.WriteLine("Could not set overlay texture.");
    }
  }
}

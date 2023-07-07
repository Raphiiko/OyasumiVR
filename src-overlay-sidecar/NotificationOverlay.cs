using System.Diagnostics;
using System.Numerics;
using System.Web;
using CefSharp;
using Valve.VR;
using OVRSharp;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Device = SharpDX.Direct3D11.Device;

namespace overlay_sidecar;

public class NotificationOverlay {
  private Overlay _overlay;
  private OffScreenBrowser _browser;
  private Texture2D _texture;
  private Device _device;
  private bool _destroyed;
  private readonly int _resolution = 1024;

  public NotificationOverlay()
  {
    CreateOverlay();
    new Thread(() =>
    {
      while (!_destroyed)
      {
        Thread.Sleep(11);
        UpdateFrame();
      }
    }).Start();
    new Thread(() =>
    {
      while (!_destroyed)
      {
        Thread.Sleep(11);
        UpdatePosition();
      }
    }).Start();
  }

  public void Dispose()
  {
    _destroyed = true;
    _browser.Dispose();
    _texture.Dispose();
    _device.Dispose();
    _overlay.Destroy();
  }

  public string? AddNotification(String message, TimeSpan? duration = null)
  {
    var script = $@"window.Oyasumi.addNotification({{
            message: ""{HttpUtility.JavaScriptStringEncode(message)}"",
            duration: {duration?.TotalMilliseconds ?? 3000}
        }});";
    var task = _browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
    task.Wait();
    return task.Result.Result as string;
  }

  public void ClearNotification(string notificationId)
  {
    var script = $@"window.Oyasumi.clearNotification(""{HttpUtility.JavaScriptStringEncode(notificationId)}"");";
    var task = _browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
    task.Wait();
  }

  private void CreateOverlay()
  {
    var uiUrl = Debugger.IsAttached ? "http://localhost:5173" : "oyasumivroverlay://ui/";
    Console.WriteLine("Using UI URL: " + uiUrl);
    _browser = new OffScreenBrowser(uiUrl, _resolution, _resolution);
    _browser.JavascriptObjectRepository.Register("NotificationApi", this);

    _device = Program.GPUFix
      ? new Device(new Factory1().GetAdapter(1), DeviceCreationFlags.BgraSupport)
      : new Device(DriverType.Hardware, DeviceCreationFlags.SingleThreaded | DeviceCreationFlags.BgraSupport);
    _texture = new Texture2D(
      _device,
      new Texture2DDescription
      {
        Width = _resolution,
        Height = _resolution,
        MipLevels = 1,
        ArraySize = 1,
        Format = Format.B8G8R8A8_UNorm,
        SampleDescription = new SampleDescription(1, 0),
        Usage = ResourceUsage.Dynamic,
        BindFlags = BindFlags.ShaderResource,
        CpuAccessFlags = CpuAccessFlags.Write
      }
    );
    _overlay = new Overlay("OYASUMIVR_NOTIFICATION_OVERLAY", "OyasumiVR Notification Overlay")
    {
      WidthInMeters = 0.35f
    };
    OpenVR.Overlay.ShowOverlay(_overlay.Handle);
  }

  private void UpdatePosition()
  {
    if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _browser.LastPaint > 1000) return;
    // Get current transform
    var currentTransform = _overlay.Transform.ToMatrix4x4();
    // Calculate target transform
    var headPose = GetHeadPose().mDeviceToAbsoluteTracking;
    var headMatrix = headPose.ToMatrix4x4();
    var offset = Matrix4x4.CreateRotationX(-15f * (float)(System.Math.PI / 180f)) *
                 Matrix4x4.CreateTranslation(0, -0.125f, -0.55f);
    var targetTransform = offset * headMatrix;
    // Lerp the position
    targetTransform = Matrix4x4.Lerp(currentTransform, targetTransform, 0.04f);
    // Apply the transformation
    _overlay.Transform = targetTransform.ToHmdMatrix34_t();
  }

  private void UpdateFrame()
  {
    if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _browser.LastPaint > 1000) return;
    _browser.RenderToTexture(_texture);
    var texture = new Texture_t
    {
      handle = _texture.NativePointer
    };
    var err = OpenVR.Overlay.SetOverlayTexture(this._overlay.Handle, ref texture);
    if (err != EVROverlayError.None)
    {
      Console.WriteLine("Could not set overlay texture.");
    }
  }

  private static TrackedDevicePose_t GetHeadPose()
  {
    var poses = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
    OpenVR.System.GetDeviceToAbsoluteTrackingPose(ETrackingUniverseOrigin.TrackingUniverseStanding, 0, poses);
    return poses[0];
  }
}

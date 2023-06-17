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
    private int _resolution = 1024;

    public NotificationOverlay()
    {
        CreateOverlay();
        new Thread(() =>
        {
            var sw = Stopwatch.StartNew();
            while (!_destroyed)
            {
                while (sw.ElapsedMilliseconds < 1000 / 120)
                {
                }

                sw.Restart();
                UpdateFrame();
            }
        }).Start();
        new Thread(() =>
        {
            while (!_destroyed)
            {
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < 1000 / 120)
                {
                }

                sw.Restart();
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

    public string AddNotification(String message, TimeSpan? duration = null)
    {
        var script = $@"window.Oyasumi.addNotification({{
            message: ""{HttpUtility.JavaScriptStringEncode(message)}"",
            duration: {duration?.TotalMilliseconds ?? 3000}
        }});";
        var task = _browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
        task.Wait();
        return (task.Result.Result as string)!;
    }

    private void CreateOverlay()
    {
        _browser = new OffScreenBrowser("oyasumivroverlay://ui/", _resolution, _resolution);
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
        _overlay = new Overlay("OYASUMIVR_NOTIFICATION_OVERLAY", "OyasumiVR Notification Overlay");
        _overlay.WidthInMeters = 0.5f;
        OpenVR.Overlay.ShowOverlay(_overlay.Handle);
    }

    private void UpdatePosition()
    {
        // Get current transform
        var currentTransform = _overlay.Transform.ToMatrix4x4();
        // Calculate target transform
        var headPose = GetHeadPose().mDeviceToAbsoluteTracking;
        var headMatrix = headPose.ToMatrix4x4();
        var offset = Matrix4x4.CreateTranslation(0, 0, -0.5f);
        var targetTransform = offset * headMatrix;
        // Lerp the position
        targetTransform = Matrix4x4.Lerp(currentTransform, targetTransform, 0.04f);
        // Apply the transformation
        _overlay.Transform = targetTransform.ToHmdMatrix34_t();
    }


    private void UpdateFrame()
    {
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

    private TrackedDevicePose_t GetHeadPose()
    {
        var poses = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
        OpenVR.System.GetDeviceToAbsoluteTrackingPose(ETrackingUniverseOrigin.TrackingUniverseStanding, 0, poses);
        return poses[0];
    }
}
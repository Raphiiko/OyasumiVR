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

public class NotificationOverlay : BaseOverlay {
  public NotificationOverlay() :
    base("/notifications", 1024, "co.raphii.oyasumi:NotificationOverlay", "OyasumiVR Notification Overlay")
  {
    overlay.WidthInMeters = 0.35f;
    overlay.Show();
    new Thread(() =>
    {
      while (!Disposed)
      {
        Thread.Sleep(11);
        UpdatePosition();
      }
    }).Start();
  }

  public string? AddNotification(String message, TimeSpan? duration = null)
  {
    var script = $@"window.OyasumiIPCIn.addNotification({{
            message: ""{HttpUtility.JavaScriptStringEncode(message)}"",
            duration: {duration?.TotalMilliseconds ?? 3000}
        }});";
    var task = browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
    task.Wait();
    return task.Result.Result as string;
  }

  public void ClearNotification(string notificationId)
  {
    var script = $@"window.OyasumiIPCIn.clearNotification(""{HttpUtility.JavaScriptStringEncode(notificationId)}"");";
    var task = browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
    task.Wait();
  }

  private void UpdatePosition()
  {
    if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - browser.LastPaint > 1000) return;
    // Get current transform
    var currentTransform = overlay.Transform.ToMatrix4x4();
    // Calculate target transform
    var headPose = OVRUtils.GetHeadPose().mDeviceToAbsoluteTracking;
    var headMatrix = headPose.ToMatrix4x4();
    var offset = Matrix4x4.CreateRotationX(-15f.ToRadians()) *
                 Matrix4x4.CreateTranslation(0, -0.125f, -0.55f);
    var targetTransform = offset * headMatrix;
    // Lerp the position
    targetTransform = Matrix4x4.Lerp(currentTransform, targetTransform, 0.04f);
    // Apply the transformation
    overlay.Transform = targetTransform.ToHmdMatrix34_t();
  }
}

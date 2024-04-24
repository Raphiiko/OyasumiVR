using System.Numerics;
using System.Web;
using CefSharp;
using Valve.VR;

namespace overlay_sidecar;

public class NotificationOverlay : BaseWebOverlay {
  private static TrackedDevicePose_t[] _poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
  private bool _updatedPositionOnce;

  public NotificationOverlay() :
    base("/notifications", 1024, "co.raphii.oyasumi:NotificationOverlay", "OyasumiVR Notification Overlay")
  {
    OpenVR.Overlay.SetOverlayWidthInMeters(OverlayHandle, 0.35f);
    OpenVR.Overlay.SetOverlaySortOrder(OverlayHandle, 150);
    OpenVR.Overlay.ShowOverlay(OverlayHandle);
    new Thread(() =>
    {
      var timer = new RefreshRateTimer();
      while (!Disposed)
      {
        timer.TickStart();
        UpdatePosition();
        timer.SleepUntilNextTick();
      }
    }).Start();
  }

  public string? AddNotification(string message, TimeSpan? duration = null)
  {
    var script = $@"window.OyasumiIPCIn.addNotification({{
            message: ""{HttpUtility.JavaScriptStringEncode(message)}"",
            duration: {duration?.TotalMilliseconds ?? 3000}
        }});";
    var task = Browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
    task.Wait();
    return task.Result.Result as string;
  }

  public void ClearNotification(string notificationId)
  {
    var script = $@"window.OyasumiIPCIn.clearNotification(""{HttpUtility.JavaScriptStringEncode(notificationId)}"");";
    var task = Browser.EvaluateScriptAsync(script, TimeSpan.FromMilliseconds(5000));
    task.Wait();
  }

  private void UpdatePosition()
  {
    if (Browser == null || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Browser.LastPaint > 1000) return;
    // Get current transform
    var origin = ETrackingUniverseOrigin.TrackingUniverseStanding;
    HmdMatrix34_t currentTransform34T = default;
    OpenVR.Overlay.GetOverlayTransformAbsolute(OverlayHandle, ref origin, ref currentTransform34T);
    var currentTransform = currentTransform34T.ToMatrix4X4();
    // Calculate target transform
    var headPose = OvrUtils.GetHeadPose(_poseBuffer).mDeviceToAbsoluteTracking;
    var headMatrix = headPose.ToMatrix4X4();
    var offset = Matrix4x4.CreateRotationX(-15f.ToRadians()) *
                 Matrix4x4.CreateTranslation(0, -0.125f, -0.55f);
    var targetTransform = offset * headMatrix;
    // Lerp the position
    if (_updatedPositionOnce)
    {
      targetTransform = Matrix4x4.Lerp(currentTransform, targetTransform, 0.04f);
    }
    // Apply the transformation
    var transform = targetTransform.ToHmdMatrix34_t();
    OpenVR.Overlay.SetOverlayTransformAbsolute(OverlayHandle, ETrackingUniverseOrigin.TrackingUniverseStanding,
      ref transform);
    _updatedPositionOnce = true;
  }
}

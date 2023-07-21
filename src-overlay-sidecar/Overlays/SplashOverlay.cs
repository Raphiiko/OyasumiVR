using System.Numerics;
using Valve.VR;

namespace overlay_sidecar;

public class SplashOverlay : BaseWebOverlay {
  private static readonly TrackedDevicePose_t[] _poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
  private bool _updatedPositionOnce;

  public SplashOverlay() :
    base("/splash", 1024, "co.raphii.oyasumi:SplashOverlay", "OyasumiVR Splash Overlay", true)
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
    var offset = Matrix4x4.CreateTranslation(0, 0, -0.55f);
    var targetTransform = offset * headMatrix;
    // Lerp the position
    if (_updatedPositionOnce)
    {
      targetTransform = Matrix4x4.Lerp(currentTransform, targetTransform, 0.02f);
    }

    // Apply the transformation
    var transform = targetTransform.ToHmdMatrix34_t();
    OpenVR.Overlay.SetOverlayTransformAbsolute(OverlayHandle, ETrackingUniverseOrigin.TrackingUniverseStanding,
      ref transform);
    _updatedPositionOnce = true;
  }
}

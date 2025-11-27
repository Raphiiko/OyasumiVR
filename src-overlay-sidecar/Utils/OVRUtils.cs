using GrcpOverlaySidecar;
using Valve.VR;

namespace overlay_sidecar;

public class OvrUtils {
  private static float _refreshRate = 90;
  private static long _refreshRateLastSet;

  public static TrackedDevicePose_t GetHeadPose(TrackedDevicePose_t[] poseBuffer)
  {
    OpenVR.System.GetDeviceToAbsoluteTrackingPose(ETrackingUniverseOrigin.TrackingUniverseStanding, 0, poseBuffer);
    return poseBuffer[0];
  }

  public static TrackedDevicePose_t? GetControllerPose(ETrackedControllerRole role, TrackedDevicePose_t[] poseBuffer)
  {
    var index = OpenVR.System.GetTrackedDeviceIndexForControllerRole(role);
    if (index is < 1 or >= OpenVR.k_unMaxTrackedDeviceCount) return null;
    OpenVR.System.GetDeviceToAbsoluteTrackingPose(ETrackingUniverseOrigin.TrackingUniverseStanding, 0, poseBuffer);
    return poseBuffer[index];
  }

  public static ETrackedControllerRole MapControllerRole(OyasumiSidecarControllerRole role)
  {
    return role switch
    {
      OyasumiSidecarControllerRole.Left => ETrackedControllerRole.LeftHand,
      OyasumiSidecarControllerRole.Right => ETrackedControllerRole.RightHand,
      _ => ETrackedControllerRole.Invalid
    };
  }

  public static EVROverlayError getOrCreateOverlay(String key, String name, ref ulong handle)
  {
    var error = OpenVR.Overlay.FindOverlay(key, ref handle);
    if (error == EVROverlayError.None) return EVROverlayError.None;
    error = OpenVR.Overlay.CreateOverlay(key, name, ref handle);
    return error;
  }

  public static float GetRefreshRate(bool force = false)
  {
    if (!force && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _refreshRateLastSet <= 5000) return _refreshRate;
    var system = OpenVR.System;
    // ReSharper disable once ConditionIsAlwaysTrueOrFalseAccordingToNullableAPIContract
    if (system == null) return _refreshRate; // This can be null sometimes...
    ETrackedPropertyError error = default;
    var displayFrequency =
      OpenVR.System.GetFloatTrackedDeviceProperty(0, ETrackedDeviceProperty.Prop_DisplayFrequency_Float, ref error);
    if (error != ETrackedPropertyError.TrackedProp_Success) return _refreshRate;
    _refreshRate = displayFrequency;
    _refreshRateLastSet = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return _refreshRate;
  }
}

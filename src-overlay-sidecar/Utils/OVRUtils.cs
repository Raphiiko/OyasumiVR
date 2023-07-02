using System.Runtime.InteropServices;
using Valve.VR;

namespace overlay_sidecar;

public class OVRUtils {
  private static float _refreshRate = 90;
  private static long _refreshRateLastSet;

  public static TrackedDevicePose_t GetHeadPose()
  {
    var poses = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
    OpenVR.System.GetDeviceToAbsoluteTrackingPose(ETrackingUniverseOrigin.TrackingUniverseStanding, 0, poses);
    return poses[0];
  }

  public static TrackedDevicePose_t? GetControllerPose(ETrackedControllerRole role)
  {
    var index = OpenVR.System.GetTrackedDeviceIndexForControllerRole(role);
    if (index is < 1 or >= OpenVR.k_unMaxTrackedDeviceCount) return null;
    var poses = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
    OpenVR.System.GetDeviceToAbsoluteTrackingPose(ETrackingUniverseOrigin.TrackingUniverseStanding, 0, poses);
    return poses[index];
  }

  public static float GetRefreshRate(bool force = false)
  {
    if (!force && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _refreshRateLastSet <= 5000) return _refreshRate;
    ETrackedPropertyError error = default;
    var displayFrequency =
      OpenVR.System.GetFloatTrackedDeviceProperty(0, ETrackedDeviceProperty.Prop_DisplayFrequency_Float, ref error);
    if (error != ETrackedPropertyError.TrackedProp_Success) return _refreshRate;
    _refreshRate = displayFrequency;
    _refreshRateLastSet = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return _refreshRate;
  }
}

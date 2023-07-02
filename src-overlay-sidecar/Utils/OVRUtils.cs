using Valve.VR;

namespace overlay_sidecar;

public class OVRUtils {
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
}

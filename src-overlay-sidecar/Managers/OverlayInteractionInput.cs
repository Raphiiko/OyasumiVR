using System.Runtime.InteropServices;
using Serilog;
using Valve.VR;

namespace overlay_sidecar;

/// <summary>
/// Reads each hand's overlay trigger during OvrManager's SteamVR input polling.
/// OverlayPointer consumes these states to manage browser mouse ownership and events.
/// </summary>
internal static class OverlayInteractionInput
{
  public const string Action = "/actions/hidden/in/OverlayInteract";

  /// <summary>
  /// Call after UpdateActionState. Updates devices and returns whether the list changed.
  /// Entries represent held or unavailable hands; released, available hands are absent.
  /// Unavailable entries signal cancellation; new press times preserve ordering within one input snapshot.
  /// </summary>
  public static bool Update(CVRInput input, CVRSystem system, ulong actionHandle,
    List<OvrManager.OvrInputDevice> devices)
  {
    var changed = false;
    foreach (var (path, role) in new[]
             {
               ("/user/hand/left", ETrackedControllerRole.LeftHand),
               ("/user/hand/right", ETrackedControllerRole.RightHand)
             })
    {
      ulong source = 0;
      var error = input.GetInputSourceHandle(path, ref source);
      InputDigitalActionData_t data = new();
      if (error == EVRInputError.None)
        error = input.GetDigitalActionData(actionHandle, ref data,
          (uint)Marshal.SizeOf<InputDigitalActionData_t>(), source);
      if (error != EVRInputError.None)
        Log.Error("Could not read overlay interaction for {Hand}: {Error}", role, error);

      var index = system.GetTrackedDeviceIndexForControllerRole(role);
      var available = error == EVRInputError.None && data.bActive &&
                      index > 0 && index < OpenVR.k_unMaxTrackedDeviceCount;
      var present = !available || data.bState;
      var previous = devices.Find(device => device.Role == role);
      if ((present && previous?.Id == index && previous.InputAvailable == available) ||
          (!present && previous == null)) continue;

      devices.RemoveAll(device => device.Role == role);
      if (present) devices.Add(new OvrManager.OvrInputDevice(index, role, available, data.fUpdateTime));
      changed = true;
    }
    return changed;
  }
}

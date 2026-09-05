using System.Runtime.InteropServices;
using Serilog;
using Valve.VR;

namespace overlay_sidecar;

internal static class OverlayInteractionInput
{
  public const string Action = "/actions/hidden/in/OverlayInteract";

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
      {
        Log.Error("Could not read overlay interaction for {Hand}: {Error}", role, error);
        continue;
      }

      var index = system.GetTrackedDeviceIndexForControllerRole(role);
      var held = data.bActive && data.bState && index > 0 && index < OpenVR.k_unMaxTrackedDeviceCount;
      var previous = devices.Find(device => device.Role == role);
      if ((held && previous?.Id == index) || (!held && previous == null)) continue;

      devices.RemoveAll(device => device.Role == role);
      if (held) devices.Add(new OvrManager.OvrInputDevice(index, role));
      changed = true;
    }
    return changed;
  }
}

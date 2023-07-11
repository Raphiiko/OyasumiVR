using Valve.VR;

namespace overlay_sidecar;

public class ButtonDetector {
  public event EventHandler<ETrackedControllerRole>? OnDoublePressA;
  public event EventHandler<ETrackedControllerRole>? OnSinglePressA;
  public event EventHandler<ETrackedControllerRole>? OnTriggerPress;
  public event EventHandler<ETrackedControllerRole>? OnTriggerRelease;

  private readonly Dictionary<ETrackedControllerRole, DateTimeOffset> _lastPressedA = new();

  public void Dispose()
  {
  }

  public void HandleEvent(EVREventType type, VREvent_t ev)
  {
    var role = OpenVR.System.GetControllerRoleForTrackedDeviceIndex(ev.trackedDeviceIndex);
    if (role != ETrackedControllerRole.LeftHand && role != ETrackedControllerRole.RightHand) return;
    switch (type)
    {
      case EVREventType.VREvent_ButtonPress:
      {
        var button = (EVRButtonId)ev.data.controller.button;

        if (button is EVRButtonId.k_EButton_IndexController_A or EVRButtonId.k_EButton_A)
        {
          OnSinglePressA?.Invoke(this, role);
          if (_lastPressedA.TryGetValue(role, out var lastPressed))
          {
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - lastPressed.ToUnixTimeMilliseconds() < 300)
            {
              OnDoublePressA?.Invoke(this, role);
              _lastPressedA[role] = DateTimeOffset.UnixEpoch;
            }
            else
            {
              _lastPressedA[role] = DateTimeOffset.UtcNow;
            }
          }
          else
          {
            _lastPressedA.Add(role, DateTimeOffset.UtcNow);
          }
        }

        if (button is EVRButtonId.k_EButton_SteamVR_Trigger) OnTriggerPress?.Invoke(this, role);

        break;
      }

      case EVREventType.VREvent_ButtonUnpress:
      {
        var button = (EVRButtonId)ev.data.controller.button;
        if (button is EVRButtonId.k_EButton_SteamVR_Trigger) OnTriggerRelease?.Invoke(this, role);

        break;
      }
      case EVREventType.VREvent_ButtonTouch:
        break;
      case EVREventType.VREvent_ButtonUntouch:
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(type), type, null);
    }
  }
}

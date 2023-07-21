using GrcpOverlaySidecar;
using Valve.VR;

namespace overlay_sidecar;

public class ButtonDetector {
  public event EventHandler<ETrackedControllerRole>? OnSinglePressA;
  public event EventHandler<ETrackedControllerRole>? OnDoublePressA;
  public event EventHandler<ETrackedControllerRole>? OnTriplePressA;
  public event EventHandler<ETrackedControllerRole>? OnSinglePressB;
  public event EventHandler<ETrackedControllerRole>? OnDoublePressB;
  public event EventHandler<ETrackedControllerRole>? OnTriplePressB;
  public event EventHandler<ETrackedControllerRole>? OnTriggerPress;
  public event EventHandler<ETrackedControllerRole>? OnTriggerRelease;

  public bool IsTriggerPressed(ETrackedControllerRole role)
  {
    return triggerPressed.TryGetValue(role, out var pressed) && pressed;
  }

  private readonly Dictionary<ETrackedControllerRole, DateTimeOffset> _lastPressedA = new();
  private readonly Dictionary<ETrackedControllerRole, DateTimeOffset> _lastDoublePressedA = new();
  private readonly Dictionary<ETrackedControllerRole, DateTimeOffset> _lastPressedB = new();
  private readonly Dictionary<ETrackedControllerRole, DateTimeOffset> _lastDoublePressedB = new();
  private readonly Dictionary<ETrackedControllerRole, bool> triggerPressed = new();

  public ButtonDetector()
  {
  }

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

        switch (button)
        {
          case EVRButtonId.k_EButton_IndexController_A or EVRButtonId.k_EButton_A:
          {
            handlePressA(role);
            break;
          }
          case EVRButtonId.k_EButton_IndexController_B:
          {
            handlePressB(role);
            break;
          }
          case EVRButtonId.k_EButton_SteamVR_Trigger:
            OnTriggerPress?.Invoke(this, role);
            triggerPressed[role] = true;
            break;
        }

        break;
      }

      case EVREventType.VREvent_ButtonUnpress:
      {
        var button = (EVRButtonId)ev.data.controller.button;
        if (button is EVRButtonId.k_EButton_SteamVR_Trigger)
        {
          OnTriggerRelease?.Invoke(this, role);
          triggerPressed[role] = false;
        }

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

  private void handlePressA(ETrackedControllerRole role)
  {
    OnSinglePressA?.Invoke(OyasumiSidecarOverlayActivationAction.SingleA, role);
    if (_lastDoublePressedA.TryGetValue(role, out var lastDoublePressed))
    {
      if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - lastDoublePressed.ToUnixTimeMilliseconds() < 300)
      {
        OnTriplePressA?.Invoke(OyasumiSidecarOverlayActivationAction.TripleA, role);
      }
    }

    if (_lastPressedA.TryGetValue(role, out var lastSinglePressed))
    {
      if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - lastSinglePressed.ToUnixTimeMilliseconds() < 300)
      {
        OnDoublePressA?.Invoke(OyasumiSidecarOverlayActivationAction.DoubleA, role);
        _lastDoublePressedA[role] = DateTimeOffset.UtcNow;
        _lastPressedA[role] = DateTimeOffset.UnixEpoch;
      }
    }

    _lastPressedA[role] = DateTimeOffset.UtcNow;
  }

  private void handlePressB(ETrackedControllerRole role)
  {
    OnSinglePressB?.Invoke(OyasumiSidecarOverlayActivationAction.SingleB, role);
    if (_lastDoublePressedB.TryGetValue(role, out var lastDoublePressed))
    {
      if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - lastDoublePressed.ToUnixTimeMilliseconds() < 300)
      {
        OnTriplePressB?.Invoke(OyasumiSidecarOverlayActivationAction.TripleB, role);
      }
    }

    if (_lastPressedB.TryGetValue(role, out var lastSinglePressed))
    {
      if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - lastSinglePressed.ToUnixTimeMilliseconds() < 300)
      {
        OnDoublePressB?.Invoke(OyasumiSidecarOverlayActivationAction.DoubleB, role);
        _lastDoublePressedB[role] = DateTimeOffset.UtcNow;
        _lastPressedB[role] = DateTimeOffset.UnixEpoch;
      }
    }

    _lastPressedB[role] = DateTimeOffset.UtcNow;
  }
}

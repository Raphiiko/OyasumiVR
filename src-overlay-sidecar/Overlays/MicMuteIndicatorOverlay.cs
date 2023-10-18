using System.Numerics;
using System.Runtime.InteropServices;
using GrcpOverlaySidecar;
using Valve.VR;

namespace overlay_sidecar;

public class MicMuteIndicatorOverlay {
  public static readonly Matrix4x4 VRC_MIC_ICON_TRANSLATION = Matrix4x4.CreateTranslation(-0.48f, -0.405f, -1.15f);
  private readonly ulong _overlayHandle;
  private readonly (byte[], int, int) _muteImage;
  private readonly (byte[], int, int) _unmuteImage;
  private readonly float _baseScale = 0.088f;
  private bool _muteState = true;
  private double _maxOpacity = 100;
  private bool _disposed;
  private bool _enabled;
  private bool _fadeOut;
  private DateTime _lastStateChange = DateTime.MinValue;
  private DateTime _lastPresenceIndication = DateTime.MinValue;

  public MicMuteIndicatorOverlay()
  {
    // Load image resources
    _muteImage = Utils.ConvertPngToRgba(Utils.LoadEmbeddedFile("overlay-sidecar.Resources.mic_mute.png"));
    _unmuteImage = Utils.ConvertPngToRgba(Utils.LoadEmbeddedFile("overlay-sidecar.Resources.mic_unmute.png"));
    // Create the overlay
    OpenVR.Overlay.CreateOverlay("co.raphii.oyasumi:MicMuteIndicatorOverlay", "OyasumiVR Mic Mute Indicator Overlay",
      ref _overlayHandle);
    OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, 0f);
    OpenVR.Overlay.SetOverlayWidthInMeters(_overlayHandle, 0.1f);
    // Position the overlay
    var target =
      (VRC_MIC_ICON_TRANSLATION * Matrix4x4.CreateTranslation(-0.08f, 0, 0)).ToHmdMatrix34_t();

    OpenVR.Overlay.SetOverlayTransformTrackedDeviceRelative(_overlayHandle, 0, ref target);
    // Update with state changes
    StateManager.Instance.StateChanged += OnStateChanged;
    OvrManager.Instance.OnInputActionsChanged += OnInputActionsChanged;
    var state = StateManager.Instance.GetAppState();
    setMuteState(state.SystemMicMuted);
    _maxOpacity = state.Settings.SystemMicIndicatorOpacity;
    _fadeOut = state.Settings.SystemMicIndicatorFadeout;
    setEnabled(state.Settings.SystemMicIndicatorEnabled);
  }

  private void UpdateIconStateTask()
  {
    float lastSetScale = 0;
    while (!_disposed && _enabled)
    {
      var timer = new RefreshRateTimer();
      timer.TickStart();

      // Update scale
      var timeSinceLastStateChange = (DateTime.UtcNow - _lastStateChange).TotalMilliseconds;
      var scaleFactor = EasingFunctions.InQuad(MathUtils.InvLerpClamped(200, 350, (float)timeSinceLastStateChange));
      var scale = ((1 - scaleFactor) * 0.25f + 1.0f) * _baseScale;
      if (Math.Abs(lastSetScale - scale) > 0.001)
      {
        OpenVR.Overlay.SetOverlayWidthInMeters(_overlayHandle, scale);
        lastSetScale = scale;
      }

      // Update opacity
      if (_fadeOut)
      {
        var timeSinceLastPresenceIndication = (DateTime.UtcNow - _lastPresenceIndication).TotalMilliseconds;
        var timeSince = Math.Min(timeSinceLastPresenceIndication, timeSinceLastStateChange);
        // Console.WriteLine(timeSinceLastPresenceIndication);
        var opacityFactor = EasingFunctions.InQuad(MathUtils.InvLerpClamped(3000, 4000, (float)timeSince));
        var opacity = (float)(_maxOpacity / 100f * (1.0 - opacityFactor));
        OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, opacity);
      }
      else
      {
        OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, (float)(_maxOpacity / 100f));
      }

      timer.SleepUntilNextTick();
    }
  }

  private void OnStateChanged(object? sender, OyasumiSidecarState e)
  {
    if (e.SystemMicMuted != _muteState) setMuteState(e.SystemMicMuted);
    _maxOpacity = e.Settings.SystemMicIndicatorOpacity;
    _fadeOut = e.Settings.SystemMicIndicatorFadeout;
    setEnabled(e.Settings.SystemMicIndicatorEnabled);
  }

  public void Dispose()
  {
    _disposed = true;
    StateManager.Instance.StateChanged -= OnStateChanged;
    OvrManager.Instance.OnInputActionsChanged -= OnInputActionsChanged;
    OpenVR.Overlay.DestroyOverlay(_overlayHandle);
  }

  private List<uint> _lastPresenceIndicationDevices = new();

  private void OnInputActionsChanged(object? sender, Dictionary<string, List<OvrManager.OvrInputDevice>> e)
  {
    var deviceIds = e["/actions/hidden/in/IndicatePresence"].Select(d => d.Id).ToList();
    if (deviceIds.Any(d => !_lastPresenceIndicationDevices.Contains(d)))
    {
      _lastPresenceIndication = DateTime.UtcNow;
    }

    _lastPresenceIndicationDevices.Clear();
    _lastPresenceIndicationDevices.AddRange(deviceIds);
  }

  private void setImage((byte[], int, int) image)
  {
    var intPtr = Marshal.AllocHGlobal(image.Item1.Length);
    Marshal.Copy(image.Item1, 0, intPtr, image.Item1.Length);
    OpenVR.Overlay.SetOverlayRaw(_overlayHandle, intPtr, (uint)image.Item2,
      (uint)image.Item3, 4);
    Marshal.FreeHGlobal(intPtr);
  }

  private void setMuteState(bool state)
  {
    _muteState = state;
    setImage(state ? _muteImage : _unmuteImage);
    _lastStateChange = DateTime.UtcNow;
  }

  private void setEnabled(bool enabled)
  {
    if (enabled == _enabled) return;
    _enabled = enabled;
    if (enabled)
    {
      new Thread(UpdateIconStateTask).Start();
      OpenVR.Overlay.ShowOverlay(_overlayHandle);
    }
    else
    {
      OpenVR.Overlay.HideOverlay(_overlayHandle);
    }
  }
}

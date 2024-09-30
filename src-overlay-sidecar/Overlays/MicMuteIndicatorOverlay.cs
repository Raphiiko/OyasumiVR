using System.Numerics;
using GrcpOverlaySidecar;
using Serilog;
using SharpDX.Direct3D;
using Valve.VR;

namespace overlay_sidecar;

public class MicMuteIndicatorOverlay : RenderableOverlay {
  public static readonly Matrix4x4 VRC_MIC_ICON_TRANSLATION = Matrix4x4.CreateTranslation(-0.48f, -0.405f, -1.15f);
  private readonly ulong _overlayHandle;
  private readonly (byte[], uint, uint) _muteImage;
  private readonly (byte[], uint, uint) _unmuteImage;
  private bool _micActive = false;
  private TextureWriter _textureWriter;
  private readonly float _baseScale = 0.088f;
  private bool _muteState = true;
  private bool? _muteImageState;
  private double _maxOpacity = 100;
  private bool _disposed;
  private bool _enabled;
  private bool _fadeOut;
  private DateTime _lastStateChange = DateTime.MinValue;
  private DateTime _lastPresenceIndication = DateTime.MinValue;
  private DateTime _lastMicActivityChange = DateTime.MinValue;
  private float _lastSetScale = 0;

  public MicMuteIndicatorOverlay()
  {
    // Load image resources
    _muteImage =
      Utils.ConvertPngToRgba(Utils.LoadEmbeddedFile("oyasumivr-overlay-sidecar.Resources.mic_mute.png"));
    _unmuteImage =
      Utils.ConvertPngToRgba(Utils.LoadEmbeddedFile("oyasumivr-overlay-sidecar.Resources.mic_unmute.png"));
    _textureWriter = new TextureWriter(512);
    // Create the overlay
    OpenVR.Overlay.CreateOverlay("co.raphii.oyasumivr:MicMuteIndicatorOverlay", "OyasumiVR Mic Mute Indicator Overlay",
      ref _overlayHandle);
    Init();
  }

  private async void Init()
  {
    try
    {
      await _textureWriter.init();
    }
    catch (Exception e)
    {
      Log.Error("[MicMuteIndicatorOverlay] Failed to init texture writer: " + e);
      return;
    }

    // Configure the overlay
    OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, 0f);
    OpenVR.Overlay.SetOverlayWidthInMeters(_overlayHandle, 0.1f);
    // Position the overlay
    var target =
      (VRC_MIC_ICON_TRANSLATION * Matrix4x4.CreateTranslation(-0.08f, 0, 0)).ToHmdMatrix34_t();
    OpenVR.Overlay.SetOverlayTransformTrackedDeviceRelative(_overlayHandle, 0, ref target);
    // Update with state changes
    StateManager.Instance.StateChanged += OnStateChanged;
    OvrManager.Instance.OnInputActionsChanged += OnInputActionsChanged;
    OnStateChanged(null, StateManager.Instance.GetAppState());
    // Start frame updates
    OvrManager.Instance.RegisterOverlay(this);
  }

  private void OnStateChanged(object? sender, OyasumiSidecarState state)
  {
    if (state.SystemMicMuted != _muteState) setMuteState(state.SystemMicMuted);
    _maxOpacity = state.Settings.SystemMicIndicatorOpacity;
    _fadeOut = state.Settings.SystemMicIndicatorFadeout;
    setEnabled(state.Settings.SystemMicIndicatorEnabled);
  }

  public void Dispose()
  {
    _disposed = true;
    OvrManager.Instance.UnregisterOverlay(this);
    OpenVR.Overlay.DestroyOverlay(_overlayHandle);
    _textureWriter.Dispose();
    _textureWriter = null;
    GC.Collect();
    StateManager.Instance.StateChanged -= OnStateChanged;
    OvrManager.Instance.OnInputActionsChanged -= OnInputActionsChanged;
  }

  public void SetMicrophoneActive(bool active)
  {
    if (active != _micActive)
    {
      _lastMicActivityChange = DateTime.UtcNow;
    }

    _micActive = active;
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

  private void setMuteState(bool state)
  {
    _muteState = state;
    _lastStateChange = DateTime.UtcNow;
  }

  private void setEnabled(bool enabled)
  {
    if (enabled == _enabled) return;
    _enabled = enabled;
    if (enabled)
    {
      OpenVR.Overlay.ShowOverlay(_overlayHandle);
    }
    else
    {
      OpenVR.Overlay.HideOverlay(_overlayHandle);
    }
  }

  public void UpdateFrame()
  {
    if (!_enabled) return;

    var timeSinceLastStateChange = (DateTime.UtcNow - _lastStateChange).TotalMilliseconds;
    var timeSinceLastPresenceIndication = (DateTime.UtcNow - _lastPresenceIndication).TotalMilliseconds;
    var timeSinceLastMicActivityChange = (DateTime.UtcNow - _lastMicActivityChange).TotalMilliseconds;

    // Update icon if the mute state has changed
    if (_muteImageState != _muteState)
    {
      _textureWriter.WriteImageToBuffer(_muteState ? _muteImage.Item1 : _unmuteImage.Item1);
      _muteImageState = _muteState;
    }

    // Update overlay texture
    _textureWriter.WriteBufferToTexture();
    var texture = _textureWriter.AsTextureT();
    OpenVR.Overlay.SetOverlayTexture(_overlayHandle, ref texture);

    // Update opacity
    var maxOpacity = _maxOpacity * (_muteImageState == true ? 1.0f : 0.1f);
    if (_micActive && !_muteState)
    {
      OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, (float)(_maxOpacity / 100f));
    }
    else if (_fadeOut)
    {
      var timeSince = new[]
        { timeSinceLastPresenceIndication, timeSinceLastStateChange, timeSinceLastMicActivityChange }.Min();
      var opacityFactor = EasingFunctions.InQuad(MathUtils.InvLerpClamped(3500, 6000, (float)timeSince));
      var opacity = (float)(maxOpacity / 100f * (1.0 - opacityFactor));
      OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, opacity);
    }
    else
    {
      OpenVR.Overlay.SetOverlayAlpha(_overlayHandle, (float)(maxOpacity / 100f));
    }

    // Temporarily increase size when the mute state changes
    float scaleStateChangeFactor =
      EasingFunctions.InQuad(MathUtils.InvLerpClamped(200, 350, (float)timeSinceLastStateChange));
    // Temporarily increase the size when the mic is active
    float scaleActivityChangeFactor = 1;
    if (!_muteState)
    {
      var factor = EasingFunctions.InQuad(MathUtils.InvLerpClamped(0, 100, (float)timeSinceLastMicActivityChange));
      scaleActivityChangeFactor = _micActive ? 1.0f - factor : scaleActivityChangeFactor;
    }

    // Update scale
    float scaleFactor = Math.Min(scaleStateChangeFactor, scaleActivityChangeFactor);
    var scale = ((1 - scaleFactor) * 0.25f + 1.0f) * _baseScale;
    if (Math.Abs(_lastSetScale - scale) > 0.001)
    {
      OpenVR.Overlay.SetOverlayWidthInMeters(_overlayHandle, scale);
      _lastSetScale = scale;
    }
  }
}

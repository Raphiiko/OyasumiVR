using System.Numerics;
using System.Web;
using CefSharp;
using GrcpOverlaySidecar;
using Valve.VR;
using static overlay_sidecar.Utils;

namespace overlay_sidecar;

public class DashboardOverlay : BaseOverlay {
  private bool _open;
  private bool _closing;
  private Matrix4x4? _targetTransform;
  private readonly TooltipOverlay _tooltipOverlay;

  public bool Open => _open;
  public event Action OnClose;

  public DashboardOverlay() :
    base("/dashboard", 1024, "co.raphii.oyasumi:DashboardOverlay_" + Guid.NewGuid(), "OyasumiVR Dashboard Overlay")
  {
    _tooltipOverlay = new TooltipOverlay();
    OpenVR.Overlay.SetOverlayWidthInMeters(OverlayHandle, 0.45f);
    browser.JavascriptObjectRepository.Register("OyasumiIPCOut_Dashboard", this);
    new Thread(UpdateTooltipPosition).Start();
    StateManager.Instance.StateChanged += OnStateChanged;
  }

  public void Dispose()
  {
    StateManager.Instance.StateChanged -= OnStateChanged;
    _tooltipOverlay.Dispose();
    base.Dispose();
  }


  public async void open(ETrackedControllerRole role)
  {
    while (!UiReady) await Task.Delay(TimeSpan.FromMilliseconds(16));
    _targetTransform = GetTargetTransform(role);
    if (!_targetTransform.HasValue) return;
    var transform = _targetTransform.Value.ToHmdMatrix34_t();
    OpenVR.Overlay.SetOverlayTransformAbsolute(OverlayHandle,
      ETrackingUniverseOrigin.TrackingUniverseStanding,
      ref transform
    );
    _open = true;
    _closing = false;
    OVRManager.Instance.OverlayPointer!.StartForOverlay(this);
    SyncState();
    ShowDashboard();
    OpenVR.Overlay.ShowOverlay(OverlayHandle);
  }

  public async void close()
  {
    if (!_open || _closing) return;
    _closing = true;
    OVRManager.Instance.OverlayPointer!.StopForOverlay(this);
    ShowToolTip("");
    HideDashboard();
    await DelayedAction(() =>
    {
      if (!_closing) return;
      _closing = false;
      _open = false;
      _tooltipOverlay.SetText("");
      OpenVR.Overlay.HideOverlay(OverlayHandle);
      OnClose?.Invoke();
    }, TimeSpan.FromSeconds(1));
  }

  //
  // IPC OUT
  //
  public void ShowToolTip(string? text)
  {
    _tooltipOverlay.SetText(text);
  }

  public void SetSleepMode(bool enabled)
  {
  }

  //
  // Internals
  //

  private static Matrix4x4? GetTargetTransform(ETrackedControllerRole controllerRole)
  {
    var handPose = OVRUtils.GetControllerPose(controllerRole);
    var headPose = OVRUtils.GetHeadPose();
    if (handPose == null) return null;
    var handMatrix = handPose.Value.mDeviceToAbsoluteTracking.ToMatrix4x4();
    var headMatrix = headPose.mDeviceToAbsoluteTracking.ToMatrix4x4();
    var posOffset = Matrix4x4.CreateTranslation(0, 0.15f, -0.2f);
    var headRotation = Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headMatrix));
    var handPosition =
      Matrix4x4.CreateTranslation(handMatrix.Translation);
    return posOffset * headRotation * handPosition;
  }

  private void SyncState(OyasumiSidecarState? state = null)
  {
    state ??= StateManager.Instance.GetAppState();
    browser.ExecuteScriptAsync(
      @$"window.OyasumiIPCIn.setVRCStatus(""{HttpUtility.JavaScriptStringEncode(state.VrcStatus.ToString())}"");");
    var username = string.IsNullOrEmpty(state.VrcUsername)
      ? "null"
      : $@"""{HttpUtility.JavaScriptStringEncode(state.VrcUsername)}""";
    browser.ExecuteScriptAsync(@$"window.OyasumiIPCIn.setVRCUsername({username});");
    browser.ExecuteScriptAsync(@$"window.OyasumiIPCIn.setSleepMode({(state.SleepMode ? "true" : "false")});");
  }

  private void HideDashboard()
  {
    browser.ExecuteScriptAsync("window.OyasumiIPCIn.hideDashboard();");
  }

  private void ShowDashboard()
  {
    browser.ExecuteScriptAsync("window.OyasumiIPCIn.showDashboard();");
  }

  private void UpdateTooltipPosition()
  {
    var timer = new RefreshRateTimer();
    while (!Disposed)
    {
      timer.tickStart();
      var position = OVRManager.Instance.OverlayPointer!.GetPointerLocationForOverlay(this);
      if (position.HasValue) _tooltipOverlay.SetPosition(position.Value);
      timer.sleepUntilNextTick();
    }
  }

  private void OnStateChanged(object? sender, OyasumiSidecarState e)
  {
    SyncState(e);
  }
}

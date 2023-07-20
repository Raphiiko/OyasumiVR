using System.Numerics;
using CefSharp;
using Valve.VR;
using static overlay_sidecar.Utils;

namespace overlay_sidecar;

public class DashboardOverlay : BaseWebOverlay {
  private static TrackedDevicePose_t[] _poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];

  private bool _isOpen;
  private bool _closing;
  private Matrix4x4? _targetTransform;
  private readonly TooltipOverlay _tooltipOverlay;

  public bool IsOpen => _isOpen;
  public event Action? OnClose;

  public DashboardOverlay() :
    base("/dashboard", 1024, "co.raphii.oyasumi:DashboardOverlay_" + Guid.NewGuid(), "OyasumiVR Dashboard Overlay")
  {
    Browser!.JavascriptObjectRepository.Register("OyasumiIPCOut_Dashboard", this);
    _tooltipOverlay = new TooltipOverlay();
    OpenVR.Overlay.SetOverlayWidthInMeters(OverlayHandle, 0.45f);
    new Thread(UpdateTooltipPosition).Start();
  }

  public new void Dispose()
  {
    _tooltipOverlay.Dispose();
    base.Dispose();
  }


  public async void Open(ETrackedControllerRole role)
  {
    if (_isOpen) return;
    _isOpen = true;
    while (!UiReady) await Task.Delay(TimeSpan.FromMilliseconds(16));
    _targetTransform = GetTargetTransform(role);
    if (!_targetTransform.HasValue) return;
    var transform = _targetTransform.Value.ToHmdMatrix34_t();
    OpenVR.Overlay.SetOverlayTransformAbsolute(OverlayHandle,
      ETrackingUniverseOrigin.TrackingUniverseStanding,
      ref transform
    );
    _closing = false;
    OvrManager.Instance.OverlayPointer!.StartForOverlay(this);
    ShowDashboard();
    OpenVR.Overlay.ShowOverlay(OverlayHandle);
    // Browser.ShowDevTools();
  }

  public async void Close()
  {
    if (!_isOpen || _closing) return;
    _closing = true;
    OvrManager.Instance.OverlayPointer!.StopForOverlay(this);
    ShowToolTip("");
    HideDashboard();
    await DelayedAction(() =>
    {
      if (!_closing) return;
      _closing = false;
      _isOpen = false;
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

  //
  // Internals
  //

  private static Matrix4x4? GetTargetTransform(ETrackedControllerRole controllerRole)
  {
    var handPose = OvrUtils.GetControllerPose(controllerRole, _poseBuffer);
    var headPose = OvrUtils.GetHeadPose(_poseBuffer);
    if (handPose == null) return null;
    var handMatrix = handPose.Value.mDeviceToAbsoluteTracking.ToMatrix4X4();
    var headMatrix = headPose.mDeviceToAbsoluteTracking.ToMatrix4X4();
    var posOffset = Matrix4x4.CreateTranslation(0, 0.15f, -0.2f);
    var headRotation = Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headMatrix));
    var handPosition =
      Matrix4x4.CreateTranslation(handMatrix.Translation);
    return posOffset * headRotation * handPosition;
  }


  private void HideDashboard()
  {
    Browser.ExecuteScriptAsync("window.OyasumiIPCIn.hideDashboard();");
  }

  private void ShowDashboard()
  {
    Browser.ExecuteScriptAsync("window.OyasumiIPCIn.showDashboard();");
  }

  private void UpdateTooltipPosition()
  {
    var timer = new RefreshRateTimer();
    while (!Disposed)
    {
      timer.TickStart();
      var position = OvrManager.Instance.OverlayPointer?.GetPointerLocationForOverlay(this);
      if (position.HasValue) _tooltipOverlay.SetPosition(position.Value);
      timer.SleepUntilNextTick();
    }
  }
}

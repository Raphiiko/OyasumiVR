using System.Numerics;
using CefSharp;
using Valve.VR;
using static overlay_sidecar.Utils;

namespace overlay_sidecar;

public class DashboardOverlay : BaseWebOverlay {
  private static readonly TrackedDevicePose_t[] _poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];

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
    _targetTransform = GetTargetTransform(role);
    if (!_targetTransform.HasValue) return;
    _isOpen = true;
    while (!UiReady) await Task.Delay(TimeSpan.FromMilliseconds(16));
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
    if (_closing) return;
    _closing = true;
    ShowToolTip("");
    if (UiReady) HideDashboard();
    OvrManager.Instance.OverlayPointer!.StopForOverlay(this);
    await DelayedAction(() =>
    {
      OnClose?.Invoke();
      _isOpen = false;
      OpenVR.Overlay.DestroyOverlay(OverlayHandle);
    }, TimeSpan.FromSeconds(1));
  }

  //
  // Internals
  //
  protected override void ShowToolTipInternal(string? text)
  {
    _tooltipOverlay.SetText(text);
  }

  private static Matrix4x4? GetTargetTransform(ETrackedControllerRole controllerRole)
  {
    var headPose = OvrUtils.GetHeadPose(_poseBuffer);
    if (headPose.eTrackingResult != ETrackingResult.Running_OK) return null;
    var handPose = OvrUtils.GetControllerPose(controllerRole, _poseBuffer);
    // We have a valid tracked pose for the hand
    if (handPose is { eTrackingResult: ETrackingResult.Running_OK })
    {
      var handMatrix = handPose.Value.mDeviceToAbsoluteTracking.ToMatrix4X4();
      var headMatrix = headPose.mDeviceToAbsoluteTracking.ToMatrix4X4();
      var posOffset = Matrix4x4.CreateTranslation(0, 0.15f, -0.2f);
      var headRotation = Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headMatrix));
      var handPosition =
        Matrix4x4.CreateTranslation(handMatrix.Translation);
      return posOffset * headRotation * handPosition;
    }
    // In case we don't, open the dashboard relative to the head
    else
    {
      var offset = Matrix4x4.CreateTranslation(0, 0, -0.55f);
      var headMatrix = headPose.mDeviceToAbsoluteTracking.ToMatrix4X4();
      return offset * headMatrix;
    }
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

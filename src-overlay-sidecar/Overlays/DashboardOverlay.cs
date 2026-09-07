using System.Numerics;
using CefSharp;
using Valve.VR;

namespace overlay_sidecar;

public class DashboardOverlay : BaseWebOverlay {
  private static readonly TrackedDevicePose_t[] _poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];

  private bool _isOpen;
  private DateTime? _closeAt;
  private bool _shown;
  public bool IsClosing => _closeAt.HasValue;
  private Matrix4x4? _targetTransform;
  private readonly TooltipOverlay _tooltipOverlay;

  public bool IsOpen => _isOpen;
  public event Action? OnClose;

  public DashboardOverlay() :
    base("/dashboard", 1024, "co.raphii.oyasumivr:DashboardOverlay_" + Guid.NewGuid(), "OyasumiVR Dashboard Overlay")
  {
    try
    {
      Browser!.JavascriptObjectRepository.Register("OyasumiIPCOut_Dashboard", this);
      _tooltipOverlay = new TooltipOverlay();
      OpenVR.Overlay.SetOverlayWidthInMeters(OverlayHandle, 0.45f);
    }
    catch
    {
      Dispose();
      throw;
    }
  }

  public override void Dispose()
  {
    lock (OvrManager.LifecycleLock)
    {
      if (Disposed) return;
      try { _tooltipOverlay?.Dispose(); }
      finally
      {
        try { base.Dispose(); }
        finally
        {
          _isOpen = false;
          var onClose = OnClose;
          OnClose = null;
          onClose?.Invoke();
        }
      }
    }
  }

  public void Open(ETrackedControllerRole role)
  {
    lock (OvrManager.LifecycleLock)
    {
      if (Disposed || _isOpen) return;
      _targetTransform = GetTargetTransform(role);
      if (!_targetTransform.HasValue)
      {
        Dispose();
        return;
      }
      _isOpen = true;
    }
  }

  public void Close()
  {
    lock (OvrManager.LifecycleLock)
    {
      if (Disposed || IsClosing) return;
      _closeAt = DateTime.UtcNow.AddSeconds(1);
      ShowToolTip(null);
      if (UiReady) HideDashboard();
      OvrManager.Instance.OverlayPointer?.StopForOverlay(this);
    }
  }

  public override void UpdateFrame()
  {
    base.UpdateFrame();
    if (Disposed) return;
    if (IsClosing)
    {
      if (DateTime.UtcNow >= _closeAt!.Value) Dispose();
      return;
    }
    if (_isOpen && UiReady && !_shown)
    {
      var transform = _targetTransform!.Value.ToHmdMatrix34_t();
      OpenVR.Overlay.SetOverlayTransformAbsolute(OverlayHandle,
        ETrackingUniverseOrigin.TrackingUniverseStanding, ref transform);
      OvrManager.Instance.OverlayPointer?.StartForOverlay(this);
      ShowDashboard();
      OpenVR.Overlay.ShowOverlay(OverlayHandle);
      _shown = true;
    }
    var position = OvrManager.Instance.OverlayPointer?.GetPointerLocationForOverlay(this);
    if (position.HasValue) _tooltipOverlay.SetPosition(position.Value);
  }

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

}

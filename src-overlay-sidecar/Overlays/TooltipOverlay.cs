using System.Numerics;
using System.Web;
using CefSharp;
using Valve.VR;

namespace overlay_sidecar;

public class TooltipOverlay : BaseWebOverlay
{
  private static readonly TrackedDevicePose_t[] _poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];

  private bool _shown;
  private DateTime? _hideAt;
  private Matrix4x4? _targetTransform;
  private string? _text = "";

  public TooltipOverlay() :
    base("/tooltip", 512, "co.raphii.oyasumivr:TooltipOverlay_" + Guid.NewGuid(), "OyasumiVR Tooltip Overlay")
  {
    OpenVR.Overlay.SetOverlayWidthInMeters(OverlayHandle, 0.35f);
    OpenVR.Overlay.SetOverlaySortOrder(OverlayHandle, 150);
  }

  public void SetTransform(Matrix4x4 hitTransform)
  {
    _targetTransform = Matrix4x4.CreateTranslation(0, 0.025f, 0.004f) * hitTransform;
  }

  public void SetText(string? text)
  {
    lock (OvrManager.LifecycleLock)
    {
      if (Disposed) return;
      _text = text;
      if (!UiReady) return;
      var content = text != null ? $@"""{HttpUtility.JavaScriptStringEncode(text)}""" : "null";
      Browser.ExecuteScriptAsync($"window.OyasumiIPCIn.showToolTip({content})");
      if (text != null)
      {
        _shown = true;
        _hideAt = null;
        OpenVR.Overlay.ShowOverlay(OverlayHandle);
      }
      else _hideAt = DateTime.UtcNow.AddSeconds(1);
    }
  }

  public override void OnUiReady()
  {
    lock (OvrManager.LifecycleLock)
    {
      base.OnUiReady();
      SetText(_text);
    }
  }

  public override void UpdateFrame()
  {
    base.UpdateFrame();
    if (Disposed) return;
    if (_hideAt.HasValue && DateTime.UtcNow >= _hideAt.Value)
    {
      _hideAt = null;
      _shown = false;
      OpenVR.Overlay.HideOverlay(OverlayHandle);
    }
    UpdatePosition();
  }

  private void UpdatePosition()
  {
    if (!_shown || _targetTransform == null) return;
    var headPose = OvrUtils.GetHeadPose(_poseBuffer).mDeviceToAbsoluteTracking;
    var headMatrix = headPose.ToMatrix4X4();
    var targetTransform = _targetTransform.Value;
    OpenVR.Overlay.SetOverlayWidthInMeters(OverlayHandle,
      0.35f * Vector3.Distance(headMatrix.Translation, targetTransform.Translation)
    );
    var transform = targetTransform.ToHmdMatrix34_t();
    OpenVR.Overlay.SetOverlayTransformAbsolute(OverlayHandle, ETrackingUniverseOrigin.TrackingUniverseStanding,
      ref transform);
  }
}

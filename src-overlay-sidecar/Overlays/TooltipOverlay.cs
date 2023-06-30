using System.Numerics;
using System.Web;
using CefSharp;
using Valve.VR;

namespace overlay_sidecar;

public class TooltipOverlay : BaseOverlay {
  private bool _shown;
  private bool _closing;
  private Vector3? _targetPosition;

  public TooltipOverlay() :
    base("/tooltip", 512, "co.raphii.oyasumi:TooltipOverlay_" + Guid.NewGuid(), "OyasumiVR Tooltip Overlay")
  {
    overlay.WidthInMeters = 0.20f;
    overlay.SetFlag(VROverlayFlags.WantsModalBehavior, true);
    new Thread(() =>
    {
      while (!Disposed)
      {
        UpdatePosition();
        Thread.Sleep(11);
      }
    }).Start();
  }

  public void SetPosition(Vector3 position)
  {
    _targetPosition = Vector3.Add(position, new Vector3(0, 0.025f, 0));
  }

  public async void SetText(String? text)
  {
    var content = text != null ? $@"""{HttpUtility.JavaScriptStringEncode(text)}""" : "null";
    browser.ExecuteScriptAsync($"window.OyasumiIPCIn.showToolTip({content})");
    if (text != null)
    {
      _shown = true;
      _closing = false;
      overlay.Show();
    }
    else
    {
      _closing = true;
      await Utils.DelayedAction(() =>
      {
        if (!_closing) return;
        _closing = false;
        _shown = false;
        overlay.Hide();
      }, TimeSpan.FromSeconds(1));
    }
  }

  private void UpdatePosition()
  {
    if (!_shown || _targetPosition == null) return;
    // Get current transform
    var currentTransform = overlay.Transform.ToMatrix4x4();
    // Calculate target transform
    var headPose = OVRUtils.GetHeadPose().mDeviceToAbsoluteTracking;
    var headMatrix = headPose.ToMatrix4x4();
    var targetTransform =
      Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headMatrix)) *
      Matrix4x4.CreateTranslation(_targetPosition.Value);
    // Lerp the position
    targetTransform = Matrix4x4.Lerp(currentTransform, targetTransform, 0.2f);
    // Apply the transformation
    overlay.Transform = targetTransform.ToHmdMatrix34_t();
  }
}

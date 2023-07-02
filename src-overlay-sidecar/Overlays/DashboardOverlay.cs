using System.Numerics;
using System.Web;
using CefSharp;
using Valve.VR;
using static overlay_sidecar.Utils;

namespace overlay_sidecar;

public class DashboardOverlay : BaseOverlay {
  private bool _open;
  private bool _closing;
  private Matrix4x4? _targetTransform;
  private TooltipOverlay _tooltipOverlay;

  private string? vrcUsername;
  private string vrcStatus = "offline";
  private bool sleepMode = false;

  public bool Open => _open;
  public event Action OnClose;

  public DashboardOverlay() :
    base("/dashboard", 1024, "co.raphii.oyasumi:DashboardOverlay_" + Guid.NewGuid(), "OyasumiVR Dashboard Overlay")
  {
    _tooltipOverlay = new TooltipOverlay();
    overlay.WidthInMeters = 0.45f;
    browser.JavascriptObjectRepository.Register("OyasumiIPCOut_Dashboard", this);
    new Thread(UpdateTooltipPosition).Start();
  }


  public void Dispose()
  {
    _tooltipOverlay.Dispose();
    base.Dispose();
  }

  public async void open(ETrackedControllerRole role)
  {
    while (!UiReady) await Task.Delay(TimeSpan.FromMilliseconds(16));
    _targetTransform = GetTargetTransform(role);
    if (!_targetTransform.HasValue) return;
    overlay.Transform = _targetTransform.Value.ToHmdMatrix34_t();
    _open = true;
    _closing = false;
    OVRManager.Instance.OverlayPointer!.StartForOverlay(this);
    vrcUsername = "Raphiiko";
    vrcStatus = "active";
    SyncParameters();
    ShowDashboard();
    overlay.Show();
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
      overlay.Hide();
      OnClose?.Invoke();
    }, TimeSpan.FromSeconds(1));
  }

  public void ShowToolTip(string? text)
  {
    _tooltipOverlay.SetText(text);
  }

  private static Matrix4x4? GetTargetTransform(ETrackedControllerRole controllerRole)
  {
    var handPose = OVRUtils.GetControllerPose(controllerRole);
    var headPose = OVRUtils.GetHeadPose();
    if (handPose == null) return null;
    var handMatrix = handPose.Value.mDeviceToAbsoluteTracking.ToMatrix4x4();
    var headMatrix = headPose.mDeviceToAbsoluteTracking.ToMatrix4x4();
    var posOffset = Matrix4x4.CreateTranslation(0, 0.15f, -0.2f);
    var rotOffset = Matrix4x4.CreateRotationX(-75f.ToRadians());
    var handYpr = Quaternion.CreateFromRotationMatrix(handMatrix).ToYawPitchRoll();
    var headYpr = Quaternion.CreateFromRotationMatrix(headMatrix).ToYawPitchRoll();
    var origin =
      Matrix4x4.CreateFromYawPitchRoll(handYpr.X, handYpr.Y, headYpr.Z) *
      Matrix4x4.CreateTranslation(handMatrix.Translation);
    return posOffset * rotOffset * origin;
  }

  private void SyncParameters()
  {
    browser.ExecuteScriptAsync(
      @$"window.OyasumiIPCIn.setVRCStatus(""{HttpUtility.JavaScriptStringEncode(vrcStatus)}"");");
    var username = vrcUsername != null ? $@"""{HttpUtility.JavaScriptStringEncode(vrcUsername)}""" : "null";
    browser.ExecuteScriptAsync(@$"window.OyasumiIPCIn.setVRCUsername({username});");
    browser.ExecuteScriptAsync(@$"window.OyasumiIPCIn.setSleepMode({(sleepMode ? "true" : "false")});");
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
    while (!Disposed)
    {
      var position = OVRManager.Instance.OverlayPointer!.GetPointerLocationForOverlay(this);
      if (position.HasValue) _tooltipOverlay.SetPosition(position.Value);

      Thread.Sleep(16);
    }
  }
}

using GrcpOverlaySidecar;
using Grpc.Core;

namespace overlay_sidecar;

public class OyasumiOverlaySidecarService : OyasumiOverlaySidecar.OyasumiOverlaySidecarBase {
  public override Task<AddNotificationResponse> AddNotification(AddNotificationRequest request,
    ServerCallContext context)
  {
    if (OvrManager.Instance.Active == false)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "OpenVR Manager is not active"));

    if (OvrManager.Instance.NotificationOverlay == null)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "Notification overlay is currently unavailable"));

    var id = OvrManager.Instance.NotificationOverlay.AddNotification(
      request.Message,
      TimeSpan.FromMilliseconds(request.Duration)
    );
    if (id == null) return Task.FromResult(new AddNotificationResponse());

    return Task.FromResult(new AddNotificationResponse
    {
      NotificationId = id
    });
  }

  public override Task<Empty> ClearNotification(ClearNotificationRequest request,
    ServerCallContext context)
  {
    if (OvrManager.Instance.Active == false)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "OpenVR Manager is not active"));

    if (OvrManager.Instance.NotificationOverlay == null)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "Notification overlay is currently unavailable"));

    OvrManager.Instance.NotificationOverlay.ClearNotification(request.NotificationId);
    return Task.FromResult(new Empty());
  }

  public override Task<Empty> SyncState(OyasumiSidecarState request, ServerCallContext context)
  {
    StateManager.Instance.SyncState(request);
    return Task.FromResult(new Empty());
  }

  public override Task<Empty> SetDebugTranslations(SetDebugTranslationsRequest request, ServerCallContext context)
  {
    BaseWebOverlay.DebugTranslations = request.Translations;
    return Task.FromResult(new Empty());
  }

  public override Task<Empty> OpenOverlayMenu(OverlayMenuOpenRequest request, ServerCallContext context)
  {
    var role = OvrUtils.MapControllerRole(request.ControllerRole);
    OvrManager.Instance.OpenDashboard(role);
    return Task.FromResult(new Empty());
  }

  public override Task<Empty> CloseOverlayMenu(Empty request, ServerCallContext context)
  {
    OvrManager.Instance.CloseDashboard();
    return Task.FromResult(new Empty());
  }

  public override Task<Empty> ToggleOverlayMenu(OverlayMenuOpenRequest request, ServerCallContext context)
  {
    var role = OvrUtils.MapControllerRole(request.ControllerRole);
    OvrManager.Instance.ToggleDashboard(role);
    return Task.FromResult(new Empty());
  }

  public override Task<Empty> SetMicrophoneActive(SetMicrophoneActiveRequest request, ServerCallContext context)
  {
    if (request.Mode == MicrophoneActivityMode.Vrchat)
    {
      OvrManager.Instance.SetMicrophoneActive(request.Active);
    }
    return Task.FromResult(new Empty());
  }
}

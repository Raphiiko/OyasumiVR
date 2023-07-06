using GrcpOverlaySidecar;
using Grpc.Core;
using Serilog;

namespace overlay_sidecar;

public class OyasumiOverlaySidecarService : OyasumiOverlaySidecar.OyasumiOverlaySidecarBase {
  public override Task<AddNotificationResponse> AddNotification(AddNotificationRequest request,
    ServerCallContext context)
  {
    if (OVRManager.Instance.Active == false)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "OpenVR Manager is not active"));

    if (OVRManager.Instance.NotificationOverlay == null)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "Notification overlay is currently unavailable"));

    var id = OVRManager.Instance.NotificationOverlay.AddNotification(
      request.Message,
      TimeSpan.FromMilliseconds(request.Duration)
    );
    if (id == null) return Task.FromResult(new AddNotificationResponse { });

    return Task.FromResult(new AddNotificationResponse
    {
      NotificationId = id
    });
  }

  public override Task<Empty> ClearNotification(ClearNotificationRequest request,
    ServerCallContext context)
  {
    if (OVRManager.Instance.Active == false)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "OpenVR Manager is not active"));

    if (OVRManager.Instance.NotificationOverlay == null)
      throw new RpcException(new Status(StatusCode.FailedPrecondition,
        "Notification overlay is currently unavailable"));

    OVRManager.Instance.NotificationOverlay.ClearNotification(request.NotificationId);
    return Task.FromResult(new Empty { });
  }

  public override Task<Empty> SyncState(OyasumiSidecarState request, ServerCallContext context)
  {
    StateManager.Instance.SyncState(request);
    return Task.FromResult(new Empty { });
  }
}

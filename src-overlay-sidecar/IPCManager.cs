using System.Diagnostics;
using Grpc.Core;
using GrcpOyasumiCore;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Grpc.Net.Client;
using GrcpOverlaySidecar;

namespace overlay_sidecar;

public class IPCManager {
  public IPCManager(int mainProcessPort)
  {
    var builder = WebApplication.CreateBuilder();
    builder.Services.AddGrpc();
    var app = builder.Build();
    app.MapGrpcService<OyasumiOverlaySidecarService>();
    app.Start();
    new Thread(() =>
    {
      // Get the bound address
      var server = app.Services.GetRequiredService<IServer>();
      var addressFeature = server.Features.Get<IServerAddressesFeature>();
      var address = addressFeature!.Addresses.First();
      Log.Logger.Information("gRPC interface listening on address: " + address);
      // Parse port from address
      if (!int.TryParse(address.Split(':').Last(), out var port))
      {
        Log.Logger.Error("Cannot parse bound port for gRPC interface.");
        if (!Debugger.IsAttached)
        {
          Log.Logger.Information("Quitting...");
          Environment.Exit(1);
          return;
        }
      }

      using var channel = GrpcChannel.ForAddress($"http://127.0.0.1:{mainProcessPort}");
      var client = new OyasumiCore.OyasumiCoreClient(channel);
      try
      {
        client.OnOverlaySidecarStart(new OverlaySidecarStartArgs()
        {
          Pid = (uint)Environment.ProcessId,
          Port = (uint)port
        });
      }
      catch (RpcException e)
      {
        if (!Debugger.IsAttached)
        {
          Log.Logger.Error(e, "Cannot inform core of overlay sidecar start");
          Log.Logger.Information("Quitting...");
          Environment.Exit(1);
        }
        else
        {
          Log.Logger.Error("Cannot inform core of overlay sidecar start");
        }
      }
    }).Start();
  }
}

public class OyasumiOverlaySidecarService : OyasumiOverlaySidecar.OyasumiOverlaySidecarBase {
  public override Task<AddNotificationResponse> AddNotification(AddNotificationRequest request,
    ServerCallContext context)
  {
    var id = Program.OVRManager.NotificationOverlay.AddNotification(
      request.Message,
      TimeSpan.FromMilliseconds(request.Duration)
    );
    if (id == null)
    {
      return Task.FromResult(new AddNotificationResponse { });
    }

    return Task.FromResult(new AddNotificationResponse
    {
      NotificationId = id
    });
  }

  public override Task<GrcpOverlaySidecar.Empty> ClearNotification(ClearNotificationRequest request,
    ServerCallContext context)
  {
    Program.OVRManager.NotificationOverlay.ClearNotification(request.NotificationId);
    return Task.FromResult(new GrcpOverlaySidecar.Empty { });
  }
}

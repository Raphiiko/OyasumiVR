using System.Diagnostics;
using Grpc.Core;
using GrpcNotification;
using GrcpOyasumiCore;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Grpc.Net.Client;

namespace overlay_sidecar;

public class IPCManager {
    public IPCManager(int mainProcessPort)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddGrpc();
        var app = builder.Build();
        app.MapGrpcService<NotificationService>();
        app.Start();
        new Thread(async () =>
        {
            // Get the bound address
            var server = app.Services.GetRequiredService<IServer>();
            var addressFeature = server.Features.Get<IServerAddressesFeature>();
            var address = addressFeature.Addresses.First();
            Console.WriteLine("gRPC interface listening on address: " + address);
            // Parse port from address
            if (!int.TryParse(address.Split(':').Last(), out var port))
            {
                Console.Error.WriteLine("Cannot parse bound port for gRPC interface.");
                if (!Debugger.IsAttached)
                {
                    Console.Error.WriteLine("Quitting...");
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
                Console.Error.WriteLine("Cannot inform core of overlay sidecar start:");
                if (!Debugger.IsAttached)
                {
                    Console.Error.WriteLine(e);
                    Console.Error.WriteLine("Quitting...");
                    Environment.Exit(1);
                }
            }
        }).Start();
    }
}

public class NotificationService : Notification.NotificationBase {
    public override Task<NotificationResponse> AddNotification(NotificationRequest request, ServerCallContext context)
    {
        var id = Program.OVRManager.NotificationOverlay.AddNotification(
            request.Message,
            TimeSpan.FromMilliseconds(request.Duration)
        );
        return Task.FromResult(new NotificationResponse
        {
            NotificationId = id
        });
    }
}
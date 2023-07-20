using System.Diagnostics;
using System.Net;
using Grpc.Core;
using GrcpOyasumiCore;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Grpc.Net.Client;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.FileProviders;
using Serilog;

namespace overlay_sidecar;

public class IpcManager {
  public static IpcManager Instance { get; } = new();
  private bool _initialized;
  private string? _staticBaseUrl;
  private OyasumiCore.OyasumiCoreClient? _coreClient;
  private uint _coreHttpServerPort;

  public string StaticBaseUrl => _staticBaseUrl!;
  public OyasumiCore.OyasumiCoreClient CoreClient => _coreClient!;
  public string CoreHttpBaseUrl => $"http://localhost:{CoreHttpPort}";
  public uint CoreHttpPort => _coreHttpServerPort;

  private IpcManager()
  {
  }

  public void Init(int mainProcessPort)
  {
    if (_initialized) return;
    _initialized = true;
    var uiPath = Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, @"ui");
    Directory.CreateDirectory(uiPath);
    var builder = WebApplication.CreateBuilder();
    builder.Host.UseSerilog();
    builder.WebHost.ConfigureKestrel(serverOptions =>
    {
      serverOptions.Listen(IPAddress.Parse("127.0.0.1"),
        (int)(Program.InDevMode() ? Globals.OVERLAY_SIDECAR_GRPC_DEV_PORT : 0),
        listenOptions => { listenOptions.Protocols = HttpProtocols.Http2; });
      serverOptions.Listen(IPAddress.Parse("127.0.0.1"),
        (int)(Program.InDevMode() ? Globals.OVERLAY_SIDECAR_GRPC_WEB_DEV_PORT : 0),
        listenOptions => { listenOptions.Protocols = HttpProtocols.Http1; });
    });
    builder.Services.AddCors(o => o.AddPolicy("AllowAll", corsPolicyBuilder =>
    {
      corsPolicyBuilder.AllowAnyOrigin()
        .AllowAnyMethod()
        .AllowAnyHeader()
        .WithExposedHeaders("Grpc-Status", "Grpc-Message", "Grpc-Encoding", "Grpc-Accept-Encoding");
    }));
    builder.Services.AddGrpc();
    var app = builder.Build();
    app.UseGrpcWeb();
    app.UseCors();
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.UseFileServer(new FileServerOptions()
    {
      FileProvider = new PhysicalFileProvider(uiPath),
      RequestPath = new PathString("/static"),
      EnableDirectoryBrowsing = false
    });
    app.MapGrpcService<OyasumiOverlaySidecarService>()
      .EnableGrpcWeb()
      .RequireCors("AllowAll");
    app.Start();
    // Get the bound address
    var server = app.Services.GetRequiredService<IServer>();
    var addressFeature = server.Features.Get<IServerAddressesFeature>();
    // Get first and second address
    var grpcAddress = addressFeature!.Addresses.First();
    var grpcWebAddress = addressFeature.Addresses.Skip(1).First();
    // Use grpc web address to determine the static url
    _staticBaseUrl = grpcWebAddress + "/static";
    Log.Information("gRPC interface listening on address: " + grpcAddress);
    Log.Information("gRPC-Web interface listening on address: " + grpcWebAddress);
    // Parse ports from addresses
    if (!int.TryParse(grpcAddress.Split(':').Last(), out var grpcPort))
    {
      Log.Error("Cannot parse bound port for gRPC interface. Quitting...");
      Environment.Exit(1);
      return;
    }

    if (!int.TryParse(grpcWebAddress.Split(':').Last(), out var grpcWebPort))
    {
      Log.Error("Cannot parse bound port for gRPC-Web interface. Quitting...");
      Environment.Exit(1);
    }

    var channel = GrpcChannel.ForAddress($"http://127.0.0.1:{mainProcessPort}");
    _coreClient = new OyasumiCore.OyasumiCoreClient(channel);
    // Get the core HTTP server port
    if (Program.InDevMode())
    {
      _coreHttpServerPort = Globals.CORE_HTTP_DEV_PORT;
    }
    else
    {
      var attempts = 0;
      var interval = 50;
      while (_coreHttpServerPort == 0)
      {
        try
        {
          var response = _coreClient.GetHTTPServerPort(new Empty());
          _coreHttpServerPort = response.Port;
        }
        catch (RpcException)
        {
        }

        if (attempts > 5000 / interval)
        {
          Log.Error("Could not get HTTP server port from core. Quitting...");
          Environment.Exit(1);
          break;
        }

        attempts++;
        Thread.Sleep(interval);
      }
    }

    // Inform the core of the overlay sidecar start
    try
    {
      _coreClient.OnOverlaySidecarStart(new OverlaySidecarStartArgs()
      {
        Pid = (uint)Environment.ProcessId,
        GrpcPort = (uint)grpcPort,
        GrpcWebPort = (uint)grpcWebPort
      });
    }
    catch (RpcException e)
    {
      Log.Error(e, "Cannot inform core of overlay sidecar start. Quitting...");
      if (Program.InReleaseMode()) Environment.Exit(1);
    }
  }
}

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
  private static readonly TimeSpan CoreStartupTimeout = TimeSpan.FromSeconds(5);
  private static readonly TimeSpan CoreRetryInterval = TimeSpan.FromMilliseconds(50);
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

    var channel = GrpcChannel.ForAddress($"http://127.0.0.1:{mainProcessPort}", new GrpcChannelOptions
    {
      HttpHandler = new SocketsHttpHandler { UseProxy = false }
    });
    _coreClient = new OyasumiCore.OyasumiCoreClient(channel);
    _coreHttpServerPort = Program.InDevMode()
      ? Globals.CORE_HTTP_DEV_PORT
      : WaitForCoreHttpServerPort(mainProcessPort);
    if (_coreHttpServerPort == 0)
    {
      Environment.Exit(1);
      return;
    }

    // Inform the core of the overlay sidecar start
    try
    {
      _coreClient.OnOverlaySidecarStart(new OverlaySidecarStartArgs()
      {
        Pid = (uint)Environment.ProcessId,
        GrpcPort = (uint)grpcPort,
        GrpcWebPort = (uint)grpcWebPort
      }, deadline: DateTime.UtcNow.Add(CoreStartupTimeout));
      Log.Information("Connected to core on gRPC port {GrpcPort} with HTTP port {HttpPort}.", mainProcessPort,
        _coreHttpServerPort);
    }
    catch (RpcException e)
    {
      Log.Error(e, "Could not announce overlay sidecar startup to core on gRPC port {Port}.", mainProcessPort);
      if (Program.InReleaseMode()) Environment.Exit(1);
    }
  }

  private uint WaitForCoreHttpServerPort(int mainProcessPort)
  {
    var deadline = DateTime.UtcNow.Add(CoreStartupTimeout);
    RpcException? lastException = null;
    while (DateTime.UtcNow < deadline)
    {
      try
      {
        var port = _coreClient!.GetHTTPServerPort(new Empty(), deadline: deadline).Port;
        if (port != 0) return port;
        lastException = null;
      }
      catch (RpcException e)
      {
        lastException = e;
      }

      if (DateTime.UtcNow < deadline) Thread.Sleep(CoreRetryInterval);
    }

    if (lastException == null)
      Log.Error("Core returned no HTTP server port within {Timeout} on gRPC port {Port}.", CoreStartupTimeout,
        mainProcessPort);
    else
      Log.Error(lastException, "Could not get the HTTP server port from core within {Timeout} on gRPC port {Port}.",
        CoreStartupTimeout, mainProcessPort);
    return 0;
  }
}

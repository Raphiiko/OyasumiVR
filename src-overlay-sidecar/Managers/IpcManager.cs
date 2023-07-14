using System.Diagnostics;
using Grpc.Core;
using GrcpOyasumiCore;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Grpc.Net.Client;
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
      Log.Error("Cannot parse bound port for gRPC interface.");
      if (!Debugger.IsAttached)
      {
        Log.Information("Quitting...");
        Environment.Exit(1);
        return;
      }
    }

    if (!int.TryParse(grpcWebAddress.Split(':').Last(), out var grpcWebPort))
    {
      Log.Error("Cannot parse bound port for gRPC-Web interface.");
      if (!Debugger.IsAttached)
      {
        Log.Information("Quitting...");
        Environment.Exit(1);
        return;
      }
    }

    var channel = GrpcChannel.ForAddress($"http://127.0.0.1:{mainProcessPort}");
    _coreClient = new OyasumiCore.OyasumiCoreClient(channel);
    // Get the core HTTP server port
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
        Log.Error("Could not get HTTP server port from core.");
        if (!Debugger.IsAttached)
        {
          Log.Information("Quitting...");
          Environment.Exit(1);
        }

        break;
      }

      attempts++;
      Thread.Sleep(interval);
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
      if (!Debugger.IsAttached)
      {
        Log.Error(e, "Cannot inform core of overlay sidecar start");
        Log.Information("Quitting...");
        Environment.Exit(1);
      }
      else
      {
        Log.Error("Cannot inform core of overlay sidecar start");
      }
    }
  }
}

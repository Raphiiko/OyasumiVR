using GrcpOyasumiCore;
using Grpc.Core;
using Grpc.Net.Client;
using Serilog;

namespace mdns_sidecar;

public class IpcManager {
  public static IpcManager Instance { get; } = new();
  private bool _initialized;
  private OyasumiCore.OyasumiCoreClient? _coreClient;
  public OyasumiCore.OyasumiCoreClient CoreClient => _coreClient!;

  private IpcManager()
  {
  }

  public void Init(int mainProcessPort)
  {
    if (_initialized) return;
    _initialized = true;

    // Setup core grpc client
    var channel = GrpcChannel.ForAddress($"http://127.0.0.1:{mainProcessPort}");
    _coreClient = new OyasumiCore.OyasumiCoreClient(channel);

    // Inform the core of the mdns sidecar start
    try
    {
      _coreClient.OnMDNSSidecarStart(new MDNSSidecarStartArgs()
      {
        Pid = (uint)Environment.ProcessId,
      });
    }
    catch (RpcException e)
    {
      Log.Error(e, "Cannot inform core of MDNS sidecar start. Quitting...");
      if (Program.InReleaseMode()) Environment.Exit(1);
    }
  }
}

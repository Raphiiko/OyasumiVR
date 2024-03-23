using System.Diagnostics;
using Serilog;
using VRC.OSCQuery;
using System.Net;
using GrcpOyasumiCore;

namespace mdns_sidecar {
  internal class Program {
    private static SidecarMode Mode = SidecarMode.Release;
    private static IDiscovery _discovery;
    public static IPAddress HostIP { get; set; } = IPAddress.Loopback;
    public static IPAddress OscIP { get; set; } = IPAddress.Loopback;

    static void Main(string[] args)
    {
      LogConfigurator.Init();
      var coreGrpcPort = (int)Globals.CORE_GRPC_DEV_PORT;
      var mainProcessId = 0;
      var oscPort = 0;
      var oscQueryPort = 0;

      // Parse args
      if (args.Length > 0 && args[0] == "dev")
      {
        Mode = SidecarMode.Dev;
      }

      if (Mode == SidecarMode.Release)
      {
        string usage = "Usage: mdns-sidecar.exe <core grpc port> <core process id> <osc port> <oscquery port>";
        if (args.Length < 4)
        {
          Log.Error(usage);
        }

        if (!int.TryParse(args[0], out coreGrpcPort))
        {
          Log.Error(usage);
          return;
        }

        if (!int.TryParse(args[1], out mainProcessId))
        {
          Log.Error(usage);
          return;
        }

        if (!int.TryParse(args[2], out oscPort))
        {
          Log.Error(usage);
          return;
        }

        if (!int.TryParse(args[3], out oscQueryPort))
        {
          Log.Error(usage);
          return;
        }
      }

      Log.Information("Starting OyasumiVR MDNS sidecar in " + (Mode == SidecarMode.Dev ? "dev" : "release") +
                      " mode.");

      _discovery = new MeaModDiscovery();

      IpcManager.Instance.Init(coreGrpcPort);

      _discovery.OnOscServiceAdded += OnOSCServiceDiscovery;
      _discovery.OnOscQueryServiceAdded += OnOSCQueryServiceDiscovery;

      AdvertiseOSCService("OyasumiVR", oscPort);
      AdvertiseOSCQueryService("OyasumiVR", oscQueryPort);

      WatchMainProcess(mainProcessId);
    }

    private static void OnOSCServiceDiscovery(OSCQueryServiceProfile profile)
    {
      if (!profile.name.StartsWith("VRChat-Client-")) return;
      IpcManager.Instance.CoreClient.SetVRChatOSCAddress(new SetAddressRequest()
      {
        Host = profile.address.ToString(),
        Port = (uint)profile.port
      });
    }

    private static void OnOSCQueryServiceDiscovery(OSCQueryServiceProfile profile)
    {
      if (!profile.name.StartsWith("VRChat-Client-")) return;
      IpcManager.Instance.CoreClient.SetVRChatOSCQueryAddress(new SetAddressRequest()
      {
        Host = profile.address.ToString(),
        Port = (uint)profile.port
      });
    }

    private static void AdvertiseOSCQueryService(string serviceName, int port = -1)
    {
      // Get random available port if none was specified
      port = port < 0 ? NetUtils.GetAvailableTcpPort() : port;
      _discovery.Advertise(new OSCQueryServiceProfile(serviceName, HostIP, port,
        OSCQueryServiceProfile.ServiceType.OSCQuery));
    }

    private static void AdvertiseOSCService(string serviceName, int port = -1)
    {
      // Get random available port if none was specified
      port = port < 0 ? NetUtils.GetAvailableUdpPort() : port;
      _discovery.Advertise(new OSCQueryServiceProfile(serviceName, OscIP, port,
        OSCQueryServiceProfile.ServiceType.OSC));
    }

    private static void WatchMainProcess(int mainPid)
    {
      if (InDevMode())
      {
        new Thread(() =>
        {
          while (true)
          {
            Thread.Sleep(1000);
          }
        }).Start();
        return;
      }

      Process? mainProcess = null;
      try
      {
        mainProcess = Process.GetProcessById(mainPid);
      }
      catch (ArgumentException)
      {
        Log.Error("Could not find main process to watch (pid=" + mainPid + "). Stopping mdns sidecar.");
        Environment.Exit(1);
        return;
      }

      new Thread(() =>
      {
        while (true)
        {
          if (mainProcess.HasExited)
          {
            Log.Information("Main process has exited. Stopping MDNS sidecar.");
            Environment.Exit(0);
            return;
          }

          Thread.Sleep(1000);
        }
      }).Start();
    }

    public static bool InDevMode()
    {
      return Mode == SidecarMode.Dev;
    }

    public static bool InReleaseMode()
    {
      return Mode == SidecarMode.Release;
    }

    public enum SidecarMode {
      Release,
      Dev
    }
  }
}

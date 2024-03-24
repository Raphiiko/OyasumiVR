using System.Net;
using System.Net.Sockets;

namespace mdns_sidecar;

public class NetUtils {
  private static readonly IPEndPoint DefaultLoopbackEndpoint = new IPEndPoint(IPAddress.Loopback, port: 0);

  public static int GetAvailableTcpPort()
  {
    using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp))
    {
      socket.Bind(DefaultLoopbackEndpoint);
      return ((IPEndPoint)socket.LocalEndPoint).Port;
    }
  }

  public static int GetAvailableUdpPort()
  {
    using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
    {
      socket.Bind(DefaultLoopbackEndpoint);
      return ((IPEndPoint)socket.LocalEndPoint).Port;
    }
  }
}

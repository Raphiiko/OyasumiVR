using System.Runtime.InteropServices;
using Valve.VR;

namespace overlay_sidecar;

public class OVRManager {
  private readonly Thread _thread;
  private NotificationOverlay? _notificationOverlay;
  private CVRSystem? _system;

  // public getter for the notification overlay
  public NotificationOverlay NotificationOverlay => _notificationOverlay!;

  public bool Active { get; set; } = true;

  public OVRManager()
  {
    _thread = new Thread(MainLoop);
    _thread.Start();
  }

  private void MainLoop()
  {
    var active = false;
    var nextInit = DateTime.MinValue;
    var e = new VREvent_t();

    while (true)
    {
      try
      {
        Thread.Sleep(32);
      }
      catch (ThreadInterruptedException err)
      {
      }

      if (Active)
      {
        _system = OpenVR.System;
        if (_system == null)
        {
          if (DateTime.UtcNow.CompareTo(nextInit) <= 0)
          {
            continue;
          }

          var err = EVRInitError.None;
          _system = OpenVR.Init(ref err, EVRApplicationType.VRApplication_Background);
          nextInit = DateTime.UtcNow.AddSeconds(5);
          if (_system == null)
          {
            continue;
          }

          active = true;
          Log.Logger.Information("OpenVR Manager Started");

          _notificationOverlay = new NotificationOverlay();
        }

        while (_system.PollNextEvent(ref e, (uint)Marshal.SizeOf(e)))
        {
          var type = (EVREventType)e.eventType;
          if (type == EVREventType.VREvent_Quit)
          {
            Log.Logger.Information("Received quit event from SteamVR. Stopping OpenVR Manager...");
            active = false;
            nextInit = DateTime.UtcNow.AddSeconds(5);
            Shutdown();
            break;
          }
        }
      }
      else if (active)
      {
        active = false;
        nextInit = DateTime.UtcNow.AddSeconds(5);
        Shutdown();
      }
    }
  }

  void Shutdown()
  {
    _notificationOverlay?.Dispose();
    _notificationOverlay = null;
    OpenVR.Shutdown();
    _system = null;
    Log.Logger.Information("Stopped OpenVR Manager");
  }
}

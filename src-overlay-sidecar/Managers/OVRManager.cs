using System.Runtime.InteropServices;
using Valve.VR;

namespace overlay_sidecar;

public class OVRManager {
  public static OVRManager Instance { get; } = new();

  private bool _initialized;
  private Thread? _thread;
  private NotificationOverlay? _notificationOverlay;
  private DashboardOverlay? _dashboardOverlay;
  private ButtonDetector? _buttonDetector;
  private CVRSystem? _system;
  private OverlayPointer? _overlayPointer;
  private bool active;

  public bool Active => active;

  public bool Enabled { get; set; } = true;
  public NotificationOverlay? NotificationOverlay => _notificationOverlay;
  public OverlayPointer? OverlayPointer => _overlayPointer;
  public ButtonDetector? ButtonDetector => _buttonDetector;


  private OVRManager()
  {
  }

  public void init()
  {
    if (_initialized) return;
    _initialized = true;
    _thread = new Thread(MainLoop);
    _thread.Start();
  }

  private void MainLoop()
  {
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

      if (Enabled)
      {
        _system = OpenVR.System;
        if (_system == null)
        {
          if (DateTime.UtcNow.CompareTo(nextInit) <= 0) continue;

          var err = EVRInitError.None;
          _system = OpenVR.Init(ref err, EVRApplicationType.VRApplication_Background);
          nextInit = DateTime.UtcNow.AddSeconds(5);
          if (_system == null) continue;

          active = true;
          Log.Logger.Information("OpenVR Manager Started");
          _buttonDetector = new ButtonDetector();
          HandleButtonDetections();
          _overlayPointer = new OverlayPointer();
          _notificationOverlay = new NotificationOverlay();
          OnDoublePressA(null, ETrackedControllerRole.RightHand);
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

          if (type is EVREventType.VREvent_ButtonPress or EVREventType.VREvent_ButtonUnpress
              or EVREventType.VREvent_ButtonTouch or EVREventType.VREvent_ButtonUntouch)
            _buttonDetector!.HandleEvent(type, e);
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

  private void Shutdown()
  {
    ClearButtonDetections();
    _overlayPointer?.Dispose();
    _overlayPointer = null;
    _buttonDetector?.Dispose();
    _buttonDetector = null;
    _notificationOverlay?.Dispose();
    _notificationOverlay = null;
    _dashboardOverlay?.Dispose();
    _dashboardOverlay = null;
    _system = null;
    OpenVR.Shutdown();
    Log.Logger.Information("Stopped OpenVR Manager");
  }

  private void HandleButtonDetections()
  {
    _buttonDetector!.OnDoublePressA += OnDoublePressA;
  }

  private void ClearButtonDetections()
  {
    _buttonDetector!.OnDoublePressA -= OnDoublePressA;
  }

  private void OnDoublePressA(object? sender, ETrackedControllerRole role)
  {
    if (_dashboardOverlay == null)
    {
      var o = new DashboardOverlay();
      _dashboardOverlay = o;
      _dashboardOverlay.open(role);
      Action onCloseHandler = null;
      onCloseHandler = () =>
      {
        o.OnClose -= onCloseHandler!;
        o.Dispose();
      };
      _dashboardOverlay.OnClose += onCloseHandler;
    }
    else
    {
      _dashboardOverlay.close();
      _dashboardOverlay = null;
    }
  }
}

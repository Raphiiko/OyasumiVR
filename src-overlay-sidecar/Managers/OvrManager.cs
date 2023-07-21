using System.Runtime.InteropServices;
using GrcpOverlaySidecar;
using Serilog;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Valve.VR;
using Device = SharpDX.Direct3D11.Device;

namespace overlay_sidecar;

public class OvrManager {
  public static OvrManager Instance { get; } = new();

  private bool _initialized;
  private readonly List<BaseWebOverlay> _overlays = new();
  private Thread? _mainThread;
  private Thread? _renderThread;
  private NotificationOverlay? _notificationOverlay;
  private DashboardOverlay? _dashboardOverlay;
  private ButtonDetector? _buttonDetector;
  private CVRSystem? _system;
  private OverlayPointer? _overlayPointer;
  private bool _active;
  private Device? _device;

  public bool Active => _active;

  // ReSharper disable once MemberCanBePrivate.Global
  public bool Enabled { get; set; } = true;
  public NotificationOverlay? NotificationOverlay => _notificationOverlay;
  public OverlayPointer? OverlayPointer => _overlayPointer;
  public ButtonDetector? ButtonDetector => _buttonDetector;

  public Device D3D11Device => _device!;

  private OvrManager()
  {
  }

  public async void Init()
  {
    if (_initialized) return;
    await InitializeDevice();
    _initialized = true;
    // Start main loop
    _mainThread = new Thread(MainLoop);
    _mainThread.Start();
    // Start frame updates for web overlays
    _renderThread = new Thread(OverlayRenderLoop);
    _renderThread.Start();
  }

  private async Task InitializeDevice()
  {
    var timings = new[] { 16, 100, 200, 500, 1000 };
    for (var attempt = 0;; attempt++)
    {
      try
      {
        _device = Program.GpuFix
          ? new Device(new Factory1().GetAdapter(1),
            DeviceCreationFlags.BgraSupport)
          : new Device(DriverType.Hardware,
            DeviceCreationFlags.BgraSupport);
      }
      catch (SharpDXException err)
      {
        if (attempt >= timings.Length)
        {
          Log.Error("Could not initialize D3D device" + err);
          throw;
        }

        await Task.Delay(timings[attempt]);
        continue;
      }

      break;
    }
  }

  private void OverlayRenderLoop()
  {
    var timer = new RefreshRateTimer();
    while (true)
    {
      if (Active)
      {
        timer.TickStart();
        lock (_overlays)
        {
          foreach (var overlay in _overlays)
            overlay.UpdateFrame();
        }

        timer.SleepUntilNextTick();
      }
      else
      {
        Thread.Sleep(100);
      }
    }
    // ReSharper disable once FunctionNeverReturns
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
      catch (ThreadInterruptedException)
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

          _active = true;
          Log.Information("OpenVR Manager Started");
          _buttonDetector = new ButtonDetector();
          HandleButtonDetections();
          _overlayPointer = new OverlayPointer();
          _notificationOverlay = new NotificationOverlay();
          new SplashOverlay();
        }

        while (_system.PollNextEvent(ref e, (uint)Marshal.SizeOf(e)))
        {
          var type = (EVREventType)e.eventType;
          if (type == EVREventType.VREvent_Quit)
          {
            Log.Information("Received quit event from SteamVR. Stopping OpenVR Manager...");
            _active = false;
            nextInit = DateTime.UtcNow.AddSeconds(5);
            Shutdown();
            break;
          }

          if (type is EVREventType.VREvent_ButtonPress or EVREventType.VREvent_ButtonUnpress
              or EVREventType.VREvent_ButtonTouch or EVREventType.VREvent_ButtonUntouch)
            _buttonDetector!.HandleEvent(type, e);
        }
      }
      else if (_active)
      {
        _active = false;
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
    Log.Information("Stopped OpenVR Manager");
  }

  private void HandleButtonDetections()
  {
    _buttonDetector!.OnSinglePressA += ToggleDashboard;
    _buttonDetector!.OnDoublePressA += ToggleDashboard;
    _buttonDetector!.OnTriplePressA += ToggleDashboard;
    _buttonDetector!.OnSinglePressB += ToggleDashboard;
    _buttonDetector!.OnDoublePressB += ToggleDashboard;
    _buttonDetector!.OnTriplePressB += ToggleDashboard;
  }

  private void ClearButtonDetections()
  {
    _buttonDetector!.OnSinglePressA -= ToggleDashboard;
    _buttonDetector!.OnDoublePressA -= ToggleDashboard;
    _buttonDetector!.OnTriplePressA -= ToggleDashboard;
    _buttonDetector!.OnSinglePressB -= ToggleDashboard;
    _buttonDetector!.OnDoublePressB -= ToggleDashboard;
    _buttonDetector!.OnTriplePressB -= ToggleDashboard;
  }

  private void ToggleDashboard(object? sender, ETrackedControllerRole role)
  {
    if (_buttonDetector == null) return;
    var action =
      (OyasumiSidecarOverlayActivationAction)(sender ?? throw new ArgumentNullException(nameof(sender)));
    // Verify it's the configured action
    var settings = StateManager.Instance.GetAppState().Settings;
    if (settings.ActivationAction != action) return;
    // Verify it's for the configured controller
    switch (settings.ActivationController)
    {
      case OyasumiSidecarOverlayActivationController.Left:
        if (role != ETrackedControllerRole.LeftHand) return;
        break;
      case OyasumiSidecarOverlayActivationController.Right:
        if (role != ETrackedControllerRole.RightHand) return;
        break;
    }

    // Verify if the trigger was held (if needed)
    if (settings.ActivationTriggerRequired && !_buttonDetector.IsTriggerPressed(role)) return;

    if (_dashboardOverlay == null)
    {
      var o = new DashboardOverlay();
      _dashboardOverlay = o;
      _dashboardOverlay.Open(role);

      void OnCloseHandler()
      {
        o.OnClose -= OnCloseHandler;
        o.Dispose();
        if (_dashboardOverlay == o) _dashboardOverlay = null;
      }

      _dashboardOverlay.OnClose += OnCloseHandler;
    }
    else
    {
      _dashboardOverlay.Close();
      _dashboardOverlay = null;
    }
  }

  public void RegisterWebOverlay(BaseWebOverlay overlay)
  {
    lock (_overlays)
    {
      if (!_overlays.Contains(overlay)) _overlays.Add(overlay);
    }
  }

  public void UnregisterWebOverlay(BaseWebOverlay overlay)
  {
    lock (_overlays)
    {
      if (_overlays.Contains(overlay)) _overlays.Remove(overlay);
    }
  }
}

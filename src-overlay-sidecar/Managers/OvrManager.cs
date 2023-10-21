using System.Runtime.InteropServices;
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
  private readonly List<RenderableOverlay> _overlays = new();
  private Thread? _mainThread;
  private Thread? _renderThread;
  private NotificationOverlay? _notificationOverlay;
  private DashboardOverlay? _dashboardOverlay;
  private CVRSystem? _system;
  private CVRInput? _input;
  private OverlayPointer? _overlayPointer;
  private MicMuteIndicatorOverlay? _micMuteIndicatorOverlay;
  private bool _active;
  private Device? _device;
  private Dictionary<string, List<OvrInputDevice>> inputActions = new();
  public event EventHandler<Dictionary<string, List<OvrInputDevice>>> OnInputActionsChanged;

  public bool Active => _active;

  // ReSharper disable once MemberCanBePrivate.Global
  public bool Enabled { get; set; } = true;
  public NotificationOverlay? NotificationOverlay => _notificationOverlay;
  public OverlayPointer? OverlayPointer => _overlayPointer;

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
    var actionHandles = new Dictionary<string, ulong>();
    var actionSetHandles = new Dictionary<string, ulong>();

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
          _system = OpenVR.System;

          _input = OpenVR.Input;
          if (_input == null) continue;
          var inputError = _input.SetActionManifestPath(GetActionManifestPath());
          if (inputError != 0)
          {
            Log.Error($"Could not set action manifest path: {Enum.GetName(typeof(EVRInputError), inputError)}");
            continue;
          }

          actionSetHandles.Clear();
          foreach (var actionSetKey in new[]
                   {
                     "/actions/main", "/actions/hidden"
                   })
          {
            ulong handle = 0;
            var result = _input.GetActionSetHandle(actionSetKey, ref handle);
            if (result != 0)
            {
              Log.Error(
                $"Could not get action set handle for {actionSetKey}: {Enum.GetName(typeof(EVRInputError), result)}");
              continue;
            }

            actionSetHandles.Add(actionSetKey, handle);
          }

          actionHandles.Clear();
          inputActions.Clear();
          foreach (var actionKey in new[]
                   {
                     "/actions/hidden/in/OverlayInteract",
                     "/actions/hidden/in/IndicatePresence",
                   })
          {
            ulong handle = 0;
            var result = _input.GetActionHandle(actionKey, ref handle);
            if (result != 0)
            {
              Log.Error($"Could not get action handle for {actionKey}: {Enum.GetName(typeof(EVRInputError), result)}");
              continue;
            }

            inputActions.Add(actionKey, new List<OvrInputDevice>());
            actionHandles.Add(actionKey, handle);
          }

          _active = true;
          Log.Information("OpenVR Manager Started");
          _overlayPointer = new OverlayPointer();
          _micMuteIndicatorOverlay = new MicMuteIndicatorOverlay();
          _notificationOverlay = new NotificationOverlay();
          BrowserManager.Instance.PreInitializeBrowser(1024, 1024);
          StartSplash();
        }

        DetectInput(actionSetHandles, actionHandles);

        while (_system.PollNextEvent(ref e, (uint)Marshal.SizeOf(e)))
        {
          var type = (EVREventType)e.eventType;
          if (type == EVREventType.VREvent_Quit)
          {
            Log.Information("Received quit event from SteamVR. Stopping OpenVR Manager...");
            _active = false;
            nextInit = DateTime.UtcNow.AddSeconds(5);
            actionHandles.Clear();
            actionSetHandles.Clear();
            inputActions.Clear();
            Shutdown();
            break;
          }
        }
      }
      else if (_active)
      {
        _active = false;
        nextInit = DateTime.UtcNow.AddSeconds(5);
        actionHandles.Clear();
        actionSetHandles.Clear();
        inputActions.Clear();
        Shutdown();
      }
    }
  }


  private void Shutdown()
  {
    _overlayPointer?.Dispose();
    _overlayPointer = null;
    _micMuteIndicatorOverlay?.Dispose();
    _micMuteIndicatorOverlay = null;
    _notificationOverlay?.Dispose();
    _notificationOverlay = null;
    _dashboardOverlay?.Dispose();
    _dashboardOverlay = null;
    _input = null;
    _system = null;
    OpenVR.Shutdown();
    Log.Information("Stopped OpenVR Manager");
  }

  public void OpenDashboard(ETrackedControllerRole role)
  {
    if (_dashboardOverlay != null)
    {
      CloseDashboard();
    }

    var o = new DashboardOverlay();
    _dashboardOverlay = o;
    _dashboardOverlay.Open(role);

    void OnCloseHandler()
    {
      o.OnClose -= OnCloseHandler;
      o.Dispose();
    }

    _dashboardOverlay.OnClose += OnCloseHandler;
  }

  public void CloseDashboard()
  {
    if (_dashboardOverlay == null) return;
    _dashboardOverlay.Close();
    _dashboardOverlay = null;
  }

  public void ToggleDashboard(ETrackedControllerRole role)
  {
    if (_dashboardOverlay == null)
    {
      OpenDashboard(role);
    }
    else
    {
      CloseDashboard();
    }
  }

  public void RegisterOverlay(RenderableOverlay overlay)
  {
    lock (_overlays)
    {
      if (!_overlays.Contains(overlay)) _overlays.Add(overlay);
    }
  }

  public void UnregisterOverlay(RenderableOverlay overlay)
  {
    lock (_overlays)
    {
      if (_overlays.Contains(overlay)) _overlays.Remove(overlay);
    }
  }

  private async void StartSplash()
  {
    await Utils.DelayedAction(() =>
    {
      if (!_active) return;
      new SplashOverlay();
    }, TimeSpan.FromSeconds(1));
  }

  private string GetActionManifestPath()
  {
    if (Program.InDevMode())
    {
      return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
        "../../../../../src-core/target/debug/resources/input/action_manifest.json"));
    }

    return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "../input/action_manifest.json"));
  }

  private void DetectInput(Dictionary<string, ulong> actionSetHandles, Dictionary<string, ulong> actionHandles)
  {
    // Get active action sets
    VRActiveActionSet_t[] pSets = new VRActiveActionSet_t[actionSetHandles.Count];
    var i = 0;
    foreach (var actionSetHandle in actionSetHandles)
    {
      pSets[i].ulActionSet = actionSetHandle.Value;
      pSets[i].ulRestrictedToDevice = OpenVR.k_ulInvalidInputValueHandle;
      pSets[i].ulSecondaryActionSet = 0;
      pSets[i].nPriority = 0;
      pSets[i].unPadding = 0;
      i++;
    }

    // Update action state for all sets
    EVRInputError error = 0;
    error = _input!.UpdateActionState(pSets, (uint)Marshal.SizeOf(typeof(VRActiveActionSet_t)));
    if (error != 0)
    {
      Log.Error($"Could not update action state: {Enum.GetName(typeof(EVRInputError), error)}");
      return;
    }

    // Check actions for changes
    InputDigitalActionData_t actionData = new();
    InputOriginInfo_t originInfo = new();
    bool update = false;
    foreach (var action in actionHandles)
    {
      // Get digital action data
      var actionKey = action.Key;
      var actionHandle = action.Value;
      error = _input.GetDigitalActionData(actionHandle, ref actionData,
        (uint)Marshal.SizeOf(typeof(InputDigitalActionData_t)),
        OpenVR.k_ulInvalidInputValueHandle);
      if (error != 0)
      {
        Log.Error($"Could not get action data for {actionKey}: {Enum.GetName(typeof(EVRInputError), error)}");
        continue;
      }

      // Skip if there was no change this frame
      if (!actionData.bChanged) continue;
      // Get the origin info for the action
      error = _input.GetOriginTrackedDeviceInfo(actionData.activeOrigin, ref originInfo,
        (uint)Marshal.SizeOf(typeof(InputOriginInfo_t)));
      if (error != 0)
      {
        Log.Error($"Could not get origin info for {actionKey}: {Enum.GetName(typeof(EVRInputError), error)}");
        continue;
      }

      // Determine the controller role
      var role = _system!.GetControllerRoleForTrackedDeviceIndex(originInfo.trackedDeviceIndex);

      var deviceExists = inputActions[actionKey].Any(x => x.Id == originInfo.trackedDeviceIndex);
      if (actionData.bState && !deviceExists)
      {
        update = true;
        inputActions[actionKey].Add(new OvrInputDevice(originInfo.trackedDeviceIndex, role));
      }
      else if (!actionData.bState && deviceExists)
      {
        update = true;
        inputActions[actionKey].RemoveAll(x => x.Id == originInfo.trackedDeviceIndex);
      }
    }

    if (update)
    {
      OnInputActionsChanged.Invoke(this, inputActions);
    }
  }

  public class OvrInputDevice {
    public readonly uint Id;
    public readonly ETrackedControllerRole Role;

    public OvrInputDevice(uint id, ETrackedControllerRole role)
    {
      Id = id;
      Role = role;
    }
  }
}

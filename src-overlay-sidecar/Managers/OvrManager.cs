using System.Runtime.InteropServices;
using Serilog;
using Valve.VR;


namespace overlay_sidecar;

public class OvrManager
{
  public static readonly object LifecycleLock = new();
  public static OvrManager Instance { get; } = new();

  private bool _initialized;
  private Thread? _mainThread;
  private Thread? _renderThread;
  private OvrDXDeviceHander _dxDeviceHander;

  private readonly List<RenderableOverlay> _overlays = new();
  private OverlayPointer? _overlayPointer;
  private MicMuteIndicatorOverlay? _micMuteIndicatorOverlay;
  private NotificationOverlay? _notificationOverlay;
  private DashboardOverlay? _dashboardOverlay;

  private volatile bool _active;
  private DateTime? _splashAt;
  private CVRSystem? _system;
  private CVRInput? _input;
  private Dictionary<string, List<OvrInputDevice>> inputActions = new();
  public event EventHandler<Dictionary<string, List<OvrInputDevice>>> OnInputActionsChanged;

  public bool Active => _active;

  public bool Enabled { get; set; } = true;
  public NotificationOverlay? NotificationOverlay => _notificationOverlay;
  public OverlayPointer? OverlayPointer => _overlayPointer;

  public OvrDXDeviceHander DxDeviceHander => _dxDeviceHander;

  private OvrManager()
  {
    _dxDeviceHander = Program.GpuAccelerated
      ? new AcceleratedOvrDXDeviceHander()
      : new NonAcceleratedOvrDXDeviceHander();
  }

  public void Init()
  {
    if (_initialized) return;
    _initialized = true;
    // Start main loop
    _mainThread = new Thread(MainLoop);
    _mainThread.Start();
    // Start frame updates for web overlays
    _renderThread = new Thread(OverlayRenderLoop);
    _renderThread.Start();
  }

  private void OverlayRenderLoop()
  {
    var timer = new RefreshRateTimer();
    while (true)
    {
      if (Active)
      {
        timer.TickStart();
        lock (LifecycleLock)
        {
          UpdateOverlays();
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

  private void UpdateOverlays()
  {
    if (!_active) return;
    foreach (var overlay in _overlays.ToArray())
    {
      try { overlay.UpdateFrame(); }
      catch (Exception error)
      {
        Log.Error(error, "Overlay update failed. Disposing the overlay.");
        try { overlay.Dispose(); }
        catch (Exception cleanupError) { Log.Error(cleanupError, "Could not dispose the failed overlay."); }
        throw;
      }
    }
  }

  private void MainLoop()
  {
    var nextInit = DateTime.MinValue;
    var loggedMissingInterfaces = false;
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

      lock (LifecycleLock)
      {
        try
        {
          if (Enabled)
          {
            _system = OpenVR.System;
            if (_system == null)
            {
              if (_active) Shutdown();
              if (DateTime.UtcNow.CompareTo(nextInit) <= 0) continue;

              var err = EVRInitError.None;
              _system = OpenVR.Init(ref err, EVRApplicationType.VRApplication_Background);
              nextInit = DateTime.UtcNow.AddSeconds(5);
              if (_system == null) continue;
              _system = OpenVR.System;

              _input = OpenVR.Input;
              // the overlays below and DetectInput dereference these interfaces immediately
              if (_input == null || OpenVR.Overlay == null)
              {
                // the retry runs every 5 seconds, so only the first attempt reports it
                if (!loggedMissingInterfaces)
                {
                  Log.Warning("OpenVR interfaces are not available yet. Retrying initialization later...");
                  loggedMissingInterfaces = true;
                }

                OpenVR.Shutdown();
                continue;
              }

              loggedMissingInterfaces = false;

              var inputError = _input.SetActionManifestPath(GetActionManifestPath());
              if (inputError != 0)
              {
                Log.Error($"Could not set action manifest path: {Enum.GetName(typeof(EVRInputError), inputError)}");
                OpenVR.Shutdown();
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
              _dxDeviceHander.Initialize();
              _overlayPointer = new OverlayPointer();
              _micMuteIndicatorOverlay = new MicMuteIndicatorOverlay();
              _notificationOverlay = new NotificationOverlay();
              BrowserManager.Instance.PreInitializeBrowser(1024, 1024);
              _splashAt = DateTime.UtcNow.AddSeconds(1);
            }

            if (_splashAt.HasValue && DateTime.UtcNow >= _splashAt.Value)
            {
              _splashAt = null;
              new SplashOverlay();
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
        catch (Exception error)
        {
          Log.Error(error, "OpenVR update failed. Releasing overlays before retrying.");
          nextInit = DateTime.UtcNow.AddSeconds(5);
          Shutdown();
        }
      }
    }
  }


  private void Shutdown()
  {
    _active = false;
    _splashAt = null;
    try { _overlayPointer?.Dispose(); }
    catch (Exception error) { Log.Error(error, "Could not dispose overlay pointers during shutdown."); }
    _overlayPointer = null;
    foreach (var overlay in _overlays.ToArray())
    {
      try { overlay.Dispose(); }
      catch (Exception error) { Log.Error(error, "Could not dispose an overlay during shutdown."); }
    }
    _overlays.Clear();
    _micMuteIndicatorOverlay = null;
    _notificationOverlay = null;
    _dashboardOverlay = null;
    BrowserManager.Instance.DisposeAll();
    _input = null;
    _system = null;
    OpenVR.Shutdown();
    _dxDeviceHander.Uninitialize();
    Log.Information("Stopped OpenVR Manager");
  }

  public void OpenDashboard(ETrackedControllerRole role)
  {
    lock (LifecycleLock)
    {
      if (!_active) return;
      _dashboardOverlay?.Dispose();
      var overlay = new DashboardOverlay();
      _dashboardOverlay = overlay;
      overlay.OnClose += () =>
      {
        if (_dashboardOverlay == overlay) _dashboardOverlay = null;
      };
      overlay.Open(role);
    }
  }

  public void CloseDashboard()
  {
    lock (LifecycleLock) _dashboardOverlay?.Close();
  }

  public void ToggleDashboard(ETrackedControllerRole role)
  {
    lock (LifecycleLock)
    {
      if (!_active) return;
      var index = OpenVR.System.GetTrackedDeviceIndexForControllerRole(role);
      if (index is >= 1 and < OpenVR.k_unMaxTrackedDeviceCount)
      {
        OpenVR.System.TriggerHapticPulse(index, 0, 65535);
      }

      if (_dashboardOverlay == null || _dashboardOverlay.IsClosing)
      {
        OpenDashboard(role);
      }
      else
      {
        CloseDashboard();
      }
    }
  }

  public void RegisterOverlay(RenderableOverlay overlay)
  {
    lock (LifecycleLock)
    {
      if (!_overlays.Contains(overlay)) _overlays.Add(overlay);
    }
  }

  public void UnregisterOverlay(RenderableOverlay overlay)
  {
    lock (LifecycleLock)
    {
      if (_overlays.Contains(overlay)) _overlays.Remove(overlay);
    }
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

  public void SetMicrophoneActive(bool active)
  {
    lock (LifecycleLock)
    {
      _micMuteIndicatorOverlay?.SetMicrophoneActive(active);
    }
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
      if (action.Key == OverlayInteractionInput.Action)
      {
        update |= OverlayInteractionInput.Update(_input, _system!, action.Value, inputActions[action.Key]);
        continue;
      }

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
      OnInputActionsChanged?.Invoke(this, inputActions);
    }
  }

  public class OvrInputDevice
  {
    public readonly uint Id;
    public readonly ETrackedControllerRole Role;
    public readonly bool InputAvailable;
    public readonly float InputUpdateTime;

    public OvrInputDevice(uint id, ETrackedControllerRole role, bool inputAvailable = true, float inputUpdateTime = 0)
    {
      Id = id;
      Role = role;
      InputAvailable = inputAvailable;
      InputUpdateTime = inputUpdateTime;
    }
  }
}

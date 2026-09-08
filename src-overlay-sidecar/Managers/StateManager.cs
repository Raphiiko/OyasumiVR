using GrcpOverlaySidecar;

namespace overlay_sidecar;

public class StateManager {
  public static StateManager Instance { get; } = new();
  private OyasumiSidecarState _state = NewDefaultState();

  public event EventHandler<OyasumiSidecarState>? StateChanged;

  private StateManager()
  {
  }

  public OyasumiSidecarState GetAppState()
  {
    lock (OvrManager.LifecycleLock)
    {
      return _state.Clone();
    }
  }

  public void SyncState(OyasumiSidecarState? newState)
  {
    if (newState == null) return;
    lock (OvrManager.LifecycleLock)
    {
      newState.Settings ??= new OyasumiSidecarOverlaySettings();
      _state = newState;
      StateChanged?.Invoke(this, newState);
    }
  }

  private static OyasumiSidecarState NewDefaultState()
  {
    return new OyasumiSidecarState
    {
      Settings = new OyasumiSidecarOverlaySettings()
    };
  }
}

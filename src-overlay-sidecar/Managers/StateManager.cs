using GrcpOverlaySidecar;

namespace overlay_sidecar;

public class StateManager {
  public static StateManager Instance { get; } = new();
  private OyasumiSidecarState _state = new();

  public event EventHandler<OyasumiSidecarState>? StateChanged;

  private StateManager()
  {
  }

  public OyasumiSidecarState GetAppState()
  {
    lock (_state)
    {
      return _state.Clone();
    }
  }

  public void SyncState(OyasumiSidecarState? newState)
  {
    if (newState == null) return;
    lock (_state)
    {
      // Update the state
      _state = newState;
      StateChanged?.Invoke(this, _state);
    }
  }
}

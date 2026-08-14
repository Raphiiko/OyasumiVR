using GrcpOverlaySidecar;

namespace overlay_sidecar;

public class StateManager {
  public static StateManager Instance { get; } = new();
  // Consumers read sub-messages without null checks, so the state always carries them.
  private OyasumiSidecarState _state = NewDefaultState();

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
      newState.Settings ??= new OyasumiSidecarOverlaySettings();
      _state = newState;
      StateChanged?.Invoke(this, _state);
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

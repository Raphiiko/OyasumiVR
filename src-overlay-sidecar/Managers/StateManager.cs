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
      var state = _state.Clone();
      // Clear arrays before merging so they are properly overridden
      state.DeviceInfo?.Controllers?.Clear();
      state.DeviceInfo?.Trackers?.Clear();
      // Merge in the new state
      state.MergeFrom(newState);
      // Update the state
      _state = state;
      StateChanged?.Invoke(this, _state);
    }
  }
}

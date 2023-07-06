using GrcpOverlaySidecar;

namespace overlay_sidecar;

public class StateManager {
  public static StateManager Instance { get; } = new();
  private OyasumiSidecarState _state = new();

  public event EventHandler<OyasumiSidecarState> StateChanged;

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

  public void SyncState(OyasumiSidecarState newState)
  {
    lock (_state)
    {
      var state = _state.Clone();

      if (newState.HasSleepMode && newState.SleepMode != state.SleepMode)
      {
        state.SleepMode = newState.SleepMode;
      }

      if (newState.HasVrcStatus && newState.VrcStatus != state.VrcStatus)
      {
        state.VrcStatus = newState.VrcStatus;
      }

      if (newState.HasVrcUsername && newState.VrcUsername != state.VrcUsername)
      {
        state.VrcUsername = newState.VrcUsername;
      }

      _state = state;
      StateChanged?.Invoke(this, _state);
    }
  }
}

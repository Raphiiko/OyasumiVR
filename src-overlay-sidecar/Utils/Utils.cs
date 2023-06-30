namespace overlay_sidecar;

public static class Utils {
  public static async Task DelayedAction(Action action, TimeSpan delay)
  {
    await Task.Delay(delay);
    action();
  }
}

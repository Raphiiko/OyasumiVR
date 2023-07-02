namespace overlay_sidecar;

public class RefreshRateTimer {
  private long _lastTick;

  public void tickStart()
  {
    _lastTick = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  }

  public float timeUntilNextTick(float minRefreshRate = 30, float maxRefreshRate = 144)
  {
    var refreshRate = float.Clamp(OVRUtils.GetRefreshRate(), minRefreshRate, maxRefreshRate);
    var timeSinceLastTick = (float)(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _lastTick);
    var timeUntilNextTick = 1000f / refreshRate - timeSinceLastTick;
    return timeUntilNextTick;
  }

  public void sleepUntilNextTick()
  {
    var ms = float.Max(0, timeUntilNextTick());
    Thread.Sleep((int)Math.Floor(ms));
  }
}

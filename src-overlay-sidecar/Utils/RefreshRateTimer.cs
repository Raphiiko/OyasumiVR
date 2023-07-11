namespace overlay_sidecar;

public class RefreshRateTimer {
  private long _lastTick;

  public void TickStart()
  {
    _lastTick = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  }

  public float TimeUntilNextTick(float minRefreshRate = 30, float maxRefreshRate = 144)
  {
    var refreshRate = float.Clamp(OvrUtils.GetRefreshRate(), minRefreshRate, maxRefreshRate);
    var timeSinceLastTick = (float)(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _lastTick);
    var timeUntilNextTick = 1000f / refreshRate - timeSinceLastTick;
    return timeUntilNextTick;
  }

  public void SleepUntilNextTick()
  {
    var ms = float.Max(0, TimeUntilNextTick());
    Thread.Sleep((int)Math.Floor(ms));
  }
}

using CefSharp;
using CefSharp.OffScreen;
using overlay_sidecar;
using Valve.VR;

internal static class Program
{
  private static int _checks;
  private static ChromiumWebBrowser _browser = null!;
  private static OverlayPointer _pointer = null!;
  private static BaseWebOverlay _overlay = null!;
  private const ETrackedControllerRole Left = ETrackedControllerRole.LeftHand;
  private const ETrackedControllerRole Right = ETrackedControllerRole.RightHand;

  private static int Main()
  {
    var cache = Path.Combine(Path.GetTempPath(), "oyasumi-pointer-tests-" + Guid.NewGuid().ToString("N"));
    Cef.Initialize(new CefSettings { RootCachePath = cache, LogSeverity = LogSeverity.Disable });
    try
    {
      using var browser = CreateBrowser();
      _browser = browser;
      _overlay = new() { Browser = browser };
      _pointer = new OverlayPointer();
      try
      {
        foreach (var slider in new[] { "brightness-slider", "color-temp-slider" })
        {
          InstallSlider(browser, slider);
          RunScenarios();
          Console.WriteLine(slider + ": passed");
        }
        Reset();
        Input(Left);
        _pointer.Dispose();
        Flush();
        Check("disposal releases without activation", "!slider.dragging() && ups()===1 && clicks()===0");
        Assert(_pointer.GetPointerLocationForOverlay(_overlay) == null, "disposal removes ownership");
        Assert(OpenVR.Overlay.Visible.Count == 0, "disposal removes visual pointers");
        Console.WriteLine($"PASS: {_checks} checks");
        return 0;
      }
      finally
      {
        _pointer.Dispose();
        RefreshRateTimer.Go.Release();
      }
    }
    catch (Exception error)
    {
      Console.Error.WriteLine(error);
      return 1;
    }
    finally { Cef.Shutdown(); }
  }

  private static ChromiumWebBrowser CreateBrowser()
  {
    var browser = new ChromiumWebBrowser("about:blank", automaticallyCreateBrowser: false);
    browser.Size = new System.Drawing.Size(1000, 200);
    browser.CreateBrowser();
    browser.WaitForInitialLoadAsync().GetAwaiter().GetResult();
    Eval(browser, """
      document.body.innerHTML = '<div id="a" style="position:absolute;left:100px;top:50px;width:200px;height:100px">A</div><div id="b" style="position:absolute;left:700px;top:50px;width:200px;height:100px">B</div>';
      document.body.style.userSelect = 'none';
      window.events = [];
      for (const type of ['mousedown', 'mouseup', 'mousemove', 'click', 'mouseleave'])
        window.addEventListener(type, e => events.push({type, x:e.clientX, buttons:e.buttons, target:e.target.id}));
      window.downs = () => events.filter(e => e.type === 'mousedown').length;
      window.ups = () => events.filter(e => e.type === 'mouseup').length;
      window.clicks = () => events.filter(e => e.type === 'click' && ['a', 'b'].includes(e.target)).length;
      window.clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      window.sig = v => { const f = () => v; f.set = x => v = x; return f; };
      a.addEventListener('mousedown', e => slider.startDragging(e));
      b.addEventListener('mousedown', e => slider.startDragging(e));
      window.addEventListener('mousemove', e => slider.onMouseMove(e));
      window.addEventListener('mouseup', () => slider.stopDragging());
      requestAnimationFrame(() => window.ready = true);
      """);
    browser.GetBrowser().GetHost().SendFocusEvent(true);
    var deadline = DateTime.UtcNow.AddSeconds(5);
    while (!Equals(Eval(browser, "window.ready===true"), true))
    {
      if (DateTime.UtcNow > deadline) throw new Exception("Browser fixture did not render");
      Thread.Sleep(10);
    }
    return browser;
  }

  private static void InstallSlider(ChromiumWebBrowser browser, string name)
  {
    var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, name + ".ts"));
    var methods = source[source.IndexOf("  startDragging(event: MouseEvent)", StringComparison.Ordinal)..]
      .Replace(": MouseEvent", "").Replace(": void", "");
    Eval(browser, """
      window.slider = new (class {
        dragging = sig(false); disabled = () => false; min = () => 0; max = () => 100;
        rangeGuide = () => ({nativeElement:{getBoundingClientRect:()=>({left:0,width:1000})}});
        dragProgression = sig(0); values = []; valueChange = {emit:v=>this.values.push(v)};
        snapValues = () => []; snapDistance = () => 0; step = () => 0;
      """ + methods + ")();");
  }

  private static void RunScenarios()
  {
    foreach (var hand in new[] { Left, Right })
    {
      var other = hand == Left ? Right : Left;
      var expected = hand == Left ? 20 : 80;
      var otherPose = hand == Left ? OvrUtils.Right : OvrUtils.Left;
      var pose = hand == Left ? OvrUtils.Left : OvrUtils.Right;
      foreach (var mode in new[] { "alone", "both", "other invalid" })
      {
        Reset();
        if (mode == "alone") otherPose.Overlay = 0;
        if (mode == "other invalid") otherPose.Valid = false;
        Frame();
        Input(hand);
        Frame();
        Input();
        Check($"{hand} click with {mode}", $"downs()===1 && ups()===1 && clicks()===1 && !slider.dragging() && slider.values.length>=2 && slider.values.every(v=>v==={expected})");
        Assert(_pointer.GetPointerLocationForOverlay(_overlay)?.X == expected * 10, "tooltip follows clicking hand");
      }

      Reset();
      Input(hand);
      pose.X = 0.5f;
      Frame();
      Check("drag follows owner", "slider.values.at(-1)===50 && slider.dragging()");
      otherPose.Overlay = 0;
      Frame();
      Check("non-owner departure cannot release or move drag", "ups()===0 && slider.dragging() && slider.values.at(-1)===50");
      otherPose.Overlay = 42;
      otherPose.Valid = false;
      Frame();
      Check("non-owner tracking loss cannot release drag", "ups()===0 && slider.dragging()");
      Input();

      Reset();
      Input(hand);
      Input(Left, Right);
      Frame();
      Input(other);
      Frame();
      Check("overlapping press is ignored after owner releases", "downs()===1 && ups()===1 && clicks()===1 && !slider.dragging()");
      Input();
      Input(other);
      Frame();
      Input();
      Check("rejected hand can press again", "downs()===2 && ups()===2 && clicks()===2");

      foreach (var loss in new[] { "tracking", "connection", "intersection", "close" })
      {
        Reset();
        Input(hand);
        if (loss == "tracking") pose.Valid = false;
        if (loss == "connection") pose.Connected = false;
        if (loss == "intersection") pose.Overlay = 0;
        if (loss == "close") _pointer.StopForOverlay(_overlay);
        Frame();
        Check("cancel on " + loss, "downs()===1 && ups()===1 && clicks()===0 && !slider.dragging()");
        pose.Valid = pose.Connected = true;
        pose.Overlay = 42;
        _pointer.StartForOverlay(_overlay);
        Frame();
        OvrManager.Instance.Poll();
        Flush();
        Check("held trigger cannot re-press after " + loss, "downs()===1 && ups()===1");
        Input();
        Input(hand);
        Frame();
        Input();
        Check("fresh press after " + loss, "downs()===2 && ups()===2 && clicks()===1");
      }

      Reset();
      pose.Overlay = 0;
      Frame();
      Input(hand);
      pose.Overlay = 42;
      Frame();
      Input();
      Check("entering while held does not click", "downs()===0 && ups()===0 && clicks()===0");

      Reset();
      Input(other);
      Input(hand);
      Frame();
      Input();
      Check("same-update release and handoff", "downs()===2 && ups()===2 && clicks()===2");
    }

    Reset();
    Frame();
    Check("idle hover does not alternate", "events.filter(e=>e.type==='mousemove').every(e=>e.x===200)");
    Assert(OpenVR.Overlay.Visible.SetEquals(new ulong[] { 1, 2 }), "both visual pointers remain visible");
    Input(Right);
    Input();
    Eval(_browser, "events=[]");
    Frame();
    Check("hover stays with last clicking hand", "events.filter(e=>e.type==='mousemove').every(e=>e.x===800)");

    using var secondBrowser = CreateBrowser();
    InstallSlider(secondBrowser, "brightness-slider");
    var second = new BaseWebOverlay { Browser = secondBrowser, OverlayHandle = 43 };
    Reset();
    _pointer.StartForOverlay(second);
    OvrUtils.Right.Overlay = 43;
    Frame();
    Eval(secondBrowser, "events=[]; slider.values=[]");
    Input(Left);
    Input(Left, Right);
    Frame();
    Input(Right);
    Frame();
    Assert(Equals(Eval(secondBrowser, "slider.dragging() && downs()===1 && ups()===0 && slider.values.every(v=>v===80)"), true),
      "separate overlay keeps its press when other hand releases");
    Input();
    Check("first overlay clicks independently", "downs()===1 && ups()===1 && clicks()===1");
    Assert(Equals(Eval(secondBrowser, "downs()===1 && ups()===1 && clicks()===1 && !slider.dragging()"), true),
      "second overlay clicks independently");

    Reset();
    OvrUtils.Left.Overlay = 42;
    OvrUtils.Right.Overlay = 0;
    Frame();
    Eval(secondBrowser, "events=[]; slider.values=[]");
    Input(Left);
    OvrUtils.Left.Overlay = 43;
    Frame();
    Input();
    Check("switching overlays cancels original control", "downs()===1 && ups()===1 && clicks()===0 && !slider.dragging()");
    Assert(Equals(Eval(secondBrowser, "downs()===0 && ups()===0 && clicks()===0"), true),
      "switching overlays cannot release into a different browser");
    _pointer.StopForOverlay(second);

    Reset();
    Input(Left);
    OpenVR.Input.Inactive.Add(Left);
    OvrManager.Instance.Poll();
    Flush();
    Check("inactive action clears held input without bChanged", "ups()===1 && !slider.dragging()");
    OpenVR.Input.Inactive.Clear();
    Input();
  }

  private static void Reset()
  {
    Input();
    _pointer.StopForOverlay(_overlay);
    OvrUtils.Left.Valid = OvrUtils.Right.Valid = true;
    OvrUtils.Left.Connected = OvrUtils.Right.Connected = true;
    OvrUtils.Left.X = 0.2f; OvrUtils.Right.X = 0.8f;
    OvrUtils.Left.Overlay = OvrUtils.Right.Overlay = 42;
    _pointer.StartForOverlay(_overlay);
    Frame();
    Eval(_browser, "events=[]; slider.values=[]; slider.stopDragging()");
  }

  private static void Input(params ETrackedControllerRole[] hands)
  {
    OvrManager.Instance.Input(hands);
    Flush();
  }

  private static void Frame() { RefreshRateTimer.Step(); Flush(); }
  private static void Flush() { Thread.Sleep(80); Eval(_browser, "true"); }
  private static object? Eval(ChromiumWebBrowser browser, string script)
  {
    var result = browser.GetMainFrame().EvaluateScriptAsync(script).GetAwaiter().GetResult();
    if (!result.Success) throw new Exception(result.Message);
    return result.Result;
  }

  private static void Check(string name, string expression)
  {
    Assert(Equals(Eval(_browser, expression), true),
      name + ": " + Eval(_browser, "JSON.stringify({events,values:slider.values,dragging:slider.dragging()})"));
  }

  private static void Assert(bool condition, string name)
  {
    if (!condition) throw new Exception("FAIL " + name);
    _checks++;
  }
}

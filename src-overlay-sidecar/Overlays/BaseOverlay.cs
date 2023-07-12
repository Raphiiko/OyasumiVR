using System.Diagnostics;
using System.Web;
using CefSharp;
using Google.Protobuf;
using GrcpOverlaySidecar;
using GrcpOyasumiCore;
using Serilog;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Valve.VR;
using Device = SharpDX.Direct3D11.Device;

namespace overlay_sidecar;

public class BaseOverlay {
  public readonly OffScreenBrowser Browser;
  protected bool UiReady;
  protected bool Disposed;
  private readonly bool _requiresState;
  private readonly Texture2D _texture;
  private readonly Device _device;
  private readonly ulong? _overlayHandle;

  public ulong OverlayHandle => _overlayHandle!.Value;

  protected BaseOverlay(string path, int resolution, string overlayKey, string overlayName, bool requiresState = true)
  {
    var uiUrl = Debugger.IsAttached
      ? "http://localhost:5173" + path
      : IpcManager.Instance.StaticBaseUrl + path;
    if (Debugger.IsAttached) Log.Information("Using UI URL: {url}", uiUrl);
    Browser = new OffScreenBrowser(uiUrl, resolution, resolution);
    _requiresState = requiresState;
    _device = Program.GPUFix
      ? new Device(new Factory1().GetAdapter(1), DeviceCreationFlags.BgraSupport)
      : new Device(DriverType.Hardware, DeviceCreationFlags.SingleThreaded | DeviceCreationFlags.BgraSupport);
    _texture = new Texture2D(
      _device,
      new Texture2DDescription
      {
        Width = resolution,
        Height = resolution,
        MipLevels = 1,
        ArraySize = 1,
        Format = Format.B8G8R8A8_UNorm,
        SampleDescription = new SampleDescription(1, 0),
        Usage = ResourceUsage.Dynamic,
        BindFlags = BindFlags.ShaderResource,
        CpuAccessFlags = CpuAccessFlags.Write
      }
    );
    Browser.JavascriptObjectRepository.Register("OyasumiIPCOut", this);
    ulong overlayHandle = 0;
    {
      var err = OpenVR.Overlay.CreateOverlay(overlayKey, overlayName, ref overlayHandle);
      if (err != EVROverlayError.None)
      {
        Log.Error("Could not create overlay: " + err);
        Dispose();
        return;
      }
    }
    this._overlayHandle = overlayHandle;
    new Thread(() =>
    {
      var timer = new RefreshRateTimer();
      while (!Disposed)
      {
        timer.TickStart();
        UpdateFrame();
        timer.SleepUntilNextTick();
      }
    }).Start();
    StateManager.Instance.StateChanged += OnStateChanged;
    SyncState();
  }

  public void Dispose()
  {
    Disposed = true;
    StateManager.Instance.StateChanged -= OnStateChanged;
    Browser.Dispose();
    _texture.Dispose();
    _device.Dispose();
    if (_overlayHandle.HasValue) OpenVR.Overlay.DestroyOverlay(_overlayHandle!.Value);
  }

  public void OnUiReady()
  {
    UiReady = true;
    SyncState();
  }

  public void SyncState(OyasumiSidecarState? state = null)
  {
    if (!UiReady || !_requiresState)
      return;
    state ??= StateManager.Instance.GetAppState();
    Browser.ExecuteScriptAsync(
      @$"window.OyasumiIPCIn.setState(""{HttpUtility.JavaScriptStringEncode(state.ToByteString().ToBase64())}"");");
  }

  public void SendEventString(string eventName, string data)
  {
    var p = new EventParams
    {
      EventName = eventName,
      StringData = data
    };
    IpcManager.Instance.CoreClient.SendEvent(p);
  }

  public void SendEventInt(string eventName, int data)
  {
    var p = new EventParams
    {
      EventName = eventName,
      IntData = data
    };
    IpcManager.Instance.CoreClient.SendEvent(p);
  }

  public void SendEventDouble(string eventName, double data)
  {
    var p = new EventParams
    {
      EventName = eventName,
      DoubleData = data
    };
    IpcManager.Instance.CoreClient.SendEvent(p);
  }

  public void SendEventBool(string eventName, bool data)
  {
    var p = new EventParams
    {
      EventName = eventName,
      BoolData = data
    };
    IpcManager.Instance.CoreClient.SendEvent(p);
  }

  public void SendEventJson(string eventName, String data)
  {
    var p = new EventParams
    {
      EventName = eventName,
      JsonData = data
    };
    IpcManager.Instance.CoreClient.SendEvent(p);
  }

  private void UpdateFrame()
  {
    if (Disposed || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Browser.LastPaint >= 1000) return;
    Browser.RenderToTexture(_texture);
    var texture = new Texture_t
    {
      handle = _texture.NativePointer
    };
    try
    {
      OpenVR.Overlay.SetOverlayTexture(_overlayHandle!.Value, ref texture);
    }
    catch (AccessViolationException)
    {
      // Shit happens sometimes
    }
  }

  private void OnStateChanged(object? sender, OyasumiSidecarState e)
  {
    SyncState(e);
  }
}

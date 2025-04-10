using System.Diagnostics;
using System.Web;
using CefSharp;
using Google.Protobuf;
using GrcpOverlaySidecar;
using GrcpOyasumiCore;
using overlay_sidecar.Browsers;
using Serilog;
using SharpDX;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Valve.VR;

namespace overlay_sidecar;

public class BaseWebOverlay : RenderableOverlay
{
  public static string DebugTranslations = "";
  public OffscreenBrowser? Browser;
  protected bool UiReady;
  protected bool Disposed;
  private readonly bool _requiresState;
  private Texture2D? _texture;
  private readonly ulong? _overlayHandle;

  public ulong OverlayHandle => _overlayHandle!.Value;

  protected BaseWebOverlay(string path, uint resolution, string overlayKey, string overlayName,
    bool requiresState = true)
  {
    var uiUrl = (Program.InDevMode()
      ? "http://localhost:5173"
      : IpcManager.Instance.StaticBaseUrl) + path + "?corePort=" + IpcManager.Instance.CoreHttpPort;
    // Set up state management
    _requiresState = requiresState;
    StateManager.Instance.StateChanged += OnStateChanged;
    // Set up browser
    if (Program.InDevMode()) Log.Information("Using UI URL: {url}", uiUrl);
    Browser = BrowserManager.Instance.GetBrowser(uiUrl, resolution, resolution);
    Browser!.JavascriptObjectRepository.Register("OyasumiIPCOut", this);
    // Set up overlay
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
    _overlayHandle = overlayHandle;
    // Initialize remaining asynchronous actions
    Init(resolution);
    // Start frame updates
    OvrManager.Instance.RegisterOverlay(this);
  }

  private async void Init(uint resolution)
  {
    _texture = await Utils.InitTexture2D(resolution, !Program.GpuAccelerated);
    Browser!.SetTextureTarget(_texture);
  }

  public void Dispose()
  {
    if (Disposed) return;
    Disposed = true;
    OvrManager.Instance.UnregisterOverlay(this);
    StateManager.Instance.StateChanged -= OnStateChanged;
    if (_overlayHandle.HasValue) OpenVR.Overlay.DestroyOverlay(_overlayHandle!.Value);
    if (Browser != null)
    {
      BrowserManager.Instance.FreeBrowser(Browser);
    }

    _texture?.Dispose();
    _texture = null;
    GC.Collect();
  }

  public void OnUiReady()
  {
    UiReady = true;
    SyncState();
  }

  public string GetDebugTranslations()
  {
    return DebugTranslations;
  }

  public void SyncState(OyasumiSidecarState? state = null)
  {
    if (!UiReady || !_requiresState)
      return;
    state ??= StateManager.Instance.GetAppState();
    Browser.ExecuteScriptAsync(
      @$"window.OyasumiIPCIn.setState(""{HttpUtility.JavaScriptStringEncode(state.ToByteString().ToBase64())}"");");
  }

  public void SendEventVoid(string eventName)
  {
    var p = new EventParams
    {
      EventName = eventName,
    };
    IpcManager.Instance.CoreClient.SendEvent(p);
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

  public string? AddNotification(string message, int duration)
  {
    var response = IpcManager.Instance.CoreClient.AddNotification(new GrcpOyasumiCore.AddNotificationRequest()
    {
      Message = message,
      Duration = (uint)duration
    });
    return response.HasNotificationId ? response.NotificationId : null;
  }

  public void ShowToolTip(string? text)
  {
    ShowToolTipInternal(text);
  }

  public void UpdateFrame()
  {
    // Stop here if we are not ready, already disposed, or if the browser hasn't painted anything new for the past second or so.
    if (_texture == null || Disposed || Browser == null ||
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Browser.LastPaint >= 1000) return;

    Browser.Render();
    var texture = new Texture_t
    {
      handle = _texture.NativePointer
    };
    // Render the texture to the overlay
    if (!Disposed && !_texture.IsDisposed)
      OpenVR.Overlay.SetOverlayTexture(_overlayHandle!.Value, ref texture);
  }

  protected virtual void ShowToolTipInternal(string? text)
  {
    // Method to be overridden by overlays in case they support tool tips
  }

  private void OnStateChanged(object? sender, OyasumiSidecarState e)
  {
    SyncState(e);
  }
}

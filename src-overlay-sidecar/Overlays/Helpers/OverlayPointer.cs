using System.Numerics;
using System.Runtime.InteropServices;
using CefSharp;
using Valve.VR;
using CefEventFlags = CefSharp.CefEventFlags;
using MouseButtonType = CefSharp.MouseButtonType;

namespace overlay_sidecar;

public class OverlayPointer {
  private readonly List<BaseOverlay> _overlays = new();
  private bool _disposed;
  private readonly PointerData _rightPointer;
  private readonly PointerData _leftPointer;

  public OverlayPointer()
  {
    // Setup pointer overlays
    _rightPointer = new PointerData()
    {
      LastUvPosition = Vector2.Zero
    };
    OpenVR.Overlay.CreateOverlay(
      "co.raphii.oyasumi:PointerRight", "OyasumiVR Right Pointer", ref _rightPointer.OverlayHandle);
    OpenVR.Overlay.SetOverlayWidthInMeters(_rightPointer.OverlayHandle, 0.02f);
    _leftPointer = new PointerData()
    {
      LastUvPosition = Vector2.Zero
    };
    OpenVR.Overlay.CreateOverlay(
      "co.raphii.oyasumi:PointerLeft", "OyasumiVR Left Pointer", ref _leftPointer.OverlayHandle);
    OpenVR.Overlay.SetOverlayWidthInMeters(_leftPointer.OverlayHandle, 0.02f);
    // Set sort order for pointer overlays
    OpenVR.Overlay.SetOverlaySortOrder(_leftPointer.OverlayHandle, 150);
    OpenVR.Overlay.SetOverlaySortOrder(_rightPointer.OverlayHandle, 150);
    // Load pointer image into overlays
    var pointerImage = Utils.ConvertPngToRgba(Utils.LoadEmbeddedFile("overlay-sidecar.Resources.pointer.png"));
    var intPtr = Marshal.AllocHGlobal(pointerImage.Item1.Length);
    Marshal.Copy(pointerImage.Item1, 0, intPtr, pointerImage.Item1.Length);
    OpenVR.Overlay.SetOverlayRaw(_rightPointer.OverlayHandle, intPtr, (uint)pointerImage.Item2,
      (uint)pointerImage.Item3, 4);
    OpenVR.Overlay.SetOverlayRaw(_leftPointer.OverlayHandle, intPtr, (uint)pointerImage.Item2,
      (uint)pointerImage.Item3, 4);
    Marshal.FreeHGlobal(intPtr);
    // Handle trigger events
    OVRManager.Instance.ButtonDetector!.OnTriggerPress += OnTriggerPress;
    OVRManager.Instance.ButtonDetector!.OnTriggerRelease += OnTriggerRelease;
    // Start tasks
    new Thread(Start).Start();
    new Thread(ProcessMouseMovement).Start();
  }


  public void Dispose()
  {
    if (_disposed) return;
    OVRManager.Instance.ButtonDetector!.OnTriggerPress -= OnTriggerPress;
    OVRManager.Instance.ButtonDetector!.OnTriggerRelease -= OnTriggerRelease;
    lock (_leftPointer)
    {
      OpenVR.Overlay.DestroyOverlay(_leftPointer.OverlayHandle);
    }

    lock (_rightPointer)
    {
      OpenVR.Overlay.DestroyOverlay(_rightPointer.OverlayHandle);
    }

    _disposed = true;
  }

  public void StartForOverlay(BaseOverlay overlay)
  {
    lock (_overlays)
    {
      if (!_overlays.Contains(overlay)) _overlays.Add(overlay);
    }
  }

  public void StopForOverlay(BaseOverlay overlay)
  {
    lock (_overlays)
    lock (_leftPointer)
    lock (_rightPointer)
    {
      if (_overlays.Contains(overlay)) _overlays.Remove(overlay);
      if (_rightPointer.LastActiveOverlay == overlay) _rightPointer.LastActiveOverlay = null;
      if (_leftPointer.LastActiveOverlay == overlay) _leftPointer.LastActiveOverlay = null;
    }
  }

  public Vector3? GetPointerLocationForOverlay(BaseOverlay overlay)
  {
    lock (_leftPointer)
    {
      if (_leftPointer.LastActiveOverlay == overlay) return _leftPointer.LastPosition;
    }

    lock (_rightPointer)
    {
      if (_rightPointer.LastActiveOverlay == overlay) return _rightPointer.LastPosition;
    }

    return null;
  }

  private void Start()
  {
    List<(VROverlayIntersectionResults_t, ETrackedControllerRole, BaseOverlay)?> intersections = new();
    var timer = new RefreshRateTimer();
    while (!_disposed)
    {
      timer.tickStart();
      // Get all intersections between each controller and overlay
      intersections.Clear();
      foreach (var controllerRole in new[]
                 { ETrackedControllerRole.LeftHand, ETrackedControllerRole.RightHand })
      {
        var controllerPose = OVRUtils.GetControllerPose(controllerRole);
        if (controllerPose is not { bPoseIsValid: true } || !controllerPose.Value.bDeviceIsConnected) continue;
        lock (_overlays)
        {
          foreach (var overlay in _overlays)
          {
            var controllerTransform = Matrix4x4.CreateRotationX(345f) * controllerPose.Value.mDeviceToAbsoluteTracking.ToMatrix4x4();
            var intersectionParams = new VROverlayIntersectionParams_t()
            {
              eOrigin = ETrackingUniverseOrigin.TrackingUniverseStanding,
              vSource = controllerTransform.Translation.ToHmdVector3_t(),
              vDirection = controllerTransform.GetDirectionNormal().ToHmdVector3_t()
            };
            var intersectionResults = new VROverlayIntersectionResults_t();
            if (!OpenVR.Overlay.ComputeOverlayIntersection(overlay.OverlayHandle, ref intersectionParams,
                  ref intersectionResults)) continue;
            intersections.Add((intersectionResults, controllerRole, overlay));
          }
        }
      }

      // Get the head transform
      var headTransform = OVRUtils.GetHeadPose().mDeviceToAbsoluteTracking.ToMatrix4x4();
      // Find the closest intersection for each controller
      var closestIntersections = intersections
        .GroupBy(x => x!.Value.Item2)
        .Select(x => x.OrderBy(y => y!.Value.Item1.fDistance).FirstOrDefault())
        .Where(x => x.HasValue)
        .ToList();
      // Update the pointer for each controller
      var rightIntersection =
        closestIntersections.FirstOrDefault(x => x!.Value.Item2 == ETrackedControllerRole.RightHand, null);
      var leftIntersection =
        closestIntersections.FirstOrDefault(x => x!.Value.Item2 == ETrackedControllerRole.LeftHand, null);
      lock (_leftPointer)
      lock (_rightPointer)
      {
        foreach (var (intersection, pointer) in new[]
                   { (rightIntersection, _rightPointer), (leftIntersection, _leftPointer) })
          if (intersection.HasValue)
          {
            var position = intersection.Value.Item1.vPoint.ToVector3();
            var transform = (Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headTransform)) *
                             Matrix4x4.CreateTranslation(position)).ToHmdMatrix34_t();
            OpenVR.Overlay.SetOverlayTransformAbsolute(pointer.OverlayHandle,
              ETrackingUniverseOrigin.TrackingUniverseStanding,
              ref transform
            );
            OpenVR.Overlay.ShowOverlay(pointer.OverlayHandle);
            pointer.LastUvPosition = intersection.Value.Item1.vUVs.ToVector2();
            pointer.LastActiveOverlay = intersection.Value.Item3;
            pointer.LastPosition = intersection.Value.Item1.vPoint.ToVector3();
            var browser = intersection.Value.Item3.Browser;
            var x = (int)(pointer.LastUvPosition.Value.X * browser.Size.Width);
            var y = (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height);
            browser.GetBrowser().GetHost().SendMouseMoveEvent(x, y, false,
              pointer.Pressed ? CefEventFlags.LeftMouseButton : CefEventFlags.None);
          }
          else
          {
            OpenVR.Overlay.HideOverlay(pointer.OverlayHandle);
            if (pointer.LastActiveOverlay != null && pointer.LastUvPosition != null)
            {
              var browser = pointer.LastActiveOverlay!.Browser;
              browser.GetBrowser().GetHost().SendMouseMoveEvent(
                (int)(pointer.LastUvPosition.Value.X * browser.Size.Width),
                (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height),
                true, CefEventFlags.None);
            }

            pointer.LastPosition = null;
            pointer.Pressed = false;
            pointer.LastUvPosition = null;
            pointer.LastActiveOverlay = null;
          }
      }

      timer.sleepUntilNextTick();
    }
  }

  private void ProcessMouseMovement()
  {
    while (!_disposed)
    {
    }
  }

  private void OnTriggerRelease(object? sender, ETrackedControllerRole e)
  {
    lock (_leftPointer)
    lock (_rightPointer)
    {
      var pointer = e switch
      {
        ETrackedControllerRole.LeftHand => _leftPointer,
        ETrackedControllerRole.RightHand => _rightPointer,
        _ => null
      };
      if (pointer == null) return;
      pointer.Pressed = false;
      if (pointer.LastActiveOverlay == null || pointer.LastUvPosition == null) return;
      var browser = pointer.LastActiveOverlay.Browser;
      var x = (int)(pointer.LastUvPosition.Value.X * browser.Size.Width);
      var y = (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height);
      browser.GetBrowser().GetHost().SendMouseClickEvent(x, y,
        MouseButtonType.Left, true, 1, CefEventFlags.None);
    }
  }

  private void OnTriggerPress(object? sender, ETrackedControllerRole e)
  {
    lock (_leftPointer)
    lock (_rightPointer)
    {
      var pointer = e switch
      {
        ETrackedControllerRole.LeftHand => _leftPointer,
        ETrackedControllerRole.RightHand => _rightPointer,
        _ => null
      };
      if (pointer == null) return;
      pointer.Pressed = true;
      if (pointer.LastActiveOverlay == null || pointer.LastUvPosition == null) return;
      var browser = pointer.LastActiveOverlay.Browser;
      var x = (int)(pointer.LastUvPosition.Value.X * browser.Size.Width);
      var y = (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height);
      browser.GetBrowser().GetHost().SendMouseClickEvent(x, y,
        MouseButtonType.Left, false, 1, CefEventFlags.None);
    }
  }

  protected class PointerData {
    public ulong OverlayHandle;
    public Vector2? LastUvPosition;
    public bool Pressed;
    public BaseOverlay? LastActiveOverlay;
    public Vector3? LastPosition;
  }
}

using System.Numerics;
using System.Runtime.InteropServices;
using CefSharp;
using Valve.VR;
using CefEventFlags = CefSharp.CefEventFlags;
using MouseButtonType = CefSharp.MouseButtonType;

namespace overlay_sidecar;

public class OverlayPointer {
  private readonly List<BaseWebOverlay> _overlays = new();
  private bool _disposed;
  private readonly PointerData _rightPointer;
  private readonly PointerData _leftPointer;
  private bool rightInteractPressed = false;
  private bool leftInteractPressed = false;

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
    OvrManager.Instance.OnInputActionsChanged += OnInputAction;
    // Start tasks
    new Thread(Start).Start();
  }


  public void Dispose()
  {
    if (_disposed) return;
    _disposed = true;
    OvrManager.Instance.OnInputActionsChanged -= OnInputAction;
    lock (_leftPointer)
    {
      OpenVR.Overlay.DestroyOverlay(_leftPointer.OverlayHandle);
    }

    lock (_rightPointer)
    {
      OpenVR.Overlay.DestroyOverlay(_rightPointer.OverlayHandle);
    }
  }

  public void StartForOverlay(BaseWebOverlay overlay)
  {
    lock (_overlays)
    {
      if (!_overlays.Contains(overlay)) _overlays.Add(overlay);
    }
  }

  public void StopForOverlay(BaseWebOverlay overlay)
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

  public Vector3? GetPointerLocationForOverlay(BaseWebOverlay overlay)
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
    // Allocate working variables
    List<(VROverlayIntersectionResults_t, ETrackedControllerRole, BaseWebOverlay)?> intersections = new();
    var closestIntersections =
      new (VROverlayIntersectionResults_t, BaseWebOverlay)?[] { null, null }; // [LEFT, RIGHT]

    var controllerRoles = new[]
      { ETrackedControllerRole.LeftHand, ETrackedControllerRole.RightHand };
    var poseBuffer = new TrackedDevicePose_t[OpenVR.k_unMaxTrackedDeviceCount];
    var intersectionParams = new VROverlayIntersectionParams_t();
    var intersectionResults = new VROverlayIntersectionResults_t();

    var timer = new RefreshRateTimer();
    while (!_disposed)
    {
      timer.TickStart();
      // Get all intersections between each controller and overlay
      intersections.Clear();
      foreach (var controllerRole in controllerRoles)
      {
        var controllerPose = OvrUtils.GetControllerPose(controllerRole, poseBuffer);
        if (controllerPose is not { bPoseIsValid: true } || !controllerPose.Value.bDeviceIsConnected) continue;
        lock (_overlays)
        {
          foreach (var overlay in _overlays)
          {
            var controllerTransform = Matrix4x4.CreateRotationX(345f) *
                                      controllerPose.Value.mDeviceToAbsoluteTracking.ToMatrix4X4();
            intersectionParams.eOrigin = ETrackingUniverseOrigin.TrackingUniverseStanding;
            intersectionParams.vSource = controllerTransform.Translation.ToHmdVector3_t();
            intersectionParams.vDirection = controllerTransform.GetDirectionNormal().ToHmdVector3_t();
            if (!OpenVR.Overlay.ComputeOverlayIntersection(overlay.OverlayHandle, ref intersectionParams,
                  ref intersectionResults)) continue;
            intersections.Add((intersectionResults, controllerRole, overlay));
          }
        }
      }

      // Find the closest intersection for each controller
      closestIntersections[0] = null;
      closestIntersections[1] = null;
      foreach (var intersection in intersections)
      {
        var index = intersection!.Value.Item2 == ETrackedControllerRole.LeftHand ? 0 : 1;
        if (!closestIntersections[index].HasValue ||
            closestIntersections[index]!.Value.Item1.fDistance > intersection.Value.Item1.fDistance)
          closestIntersections[index] = (intersection.Value.Item1, intersection.Value.Item3);
      }

      // Get the head transform
      var headTransform = OvrUtils.GetHeadPose(poseBuffer).mDeviceToAbsoluteTracking.ToMatrix4X4();

      // Update the pointer for each controller
      lock (_leftPointer)
      lock (_rightPointer)
      {
        foreach (var (intersection, pointer) in new[]
                   { (closestIntersections[0], _leftPointer), (closestIntersections[1], _rightPointer), })
        {
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
            pointer.LastActiveOverlay = intersection.Value.Item2;
            pointer.LastPosition = intersection.Value.Item1.vPoint.ToVector3();
            var browser = intersection.Value.Item2.Browser;
            if (browser != null)
            {
              var x = (int)(pointer.LastUvPosition.Value.X * browser.Size.Width);
              var y = (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height);
              browser.GetBrowser().GetHost().SendMouseMoveEvent(x, y, false,
                pointer.Pressed ? CefEventFlags.LeftMouseButton : CefEventFlags.None);
            }
          }
          else
          {
            OpenVR.Overlay.HideOverlay(pointer.OverlayHandle);
            if (pointer.LastActiveOverlay != null && pointer.LastUvPosition != null)
            {
              var browser = pointer.LastActiveOverlay!.Browser;
              if (browser != null)
              {
                browser.GetBrowser().GetHost().SendMouseMoveEvent(
                  (int)(pointer.LastUvPosition.Value.X * browser.Size.Width),
                  (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height),
                  true, CefEventFlags.None);
              }
            }

            pointer.LastPosition = null;
            pointer.Pressed = false;
            pointer.LastUvPosition = null;
            pointer.LastActiveOverlay = null;
          }
        }
      }

      timer.SleepUntilNextTick();
    }
  }

  private void OnInputAction(object? sender, Dictionary<string, List<OvrManager.OvrInputDevice>> inputActions)
  {
    var leftPressed = inputActions["/actions/hidden/in/OverlayInteract"].Any(
      device => device.Role == ETrackedControllerRole.LeftHand
    );
    if (leftPressed && !leftInteractPressed)
    {
      leftInteractPressed = true;
      OnInteractPress(ETrackedControllerRole.LeftHand);
    }
    else if (!leftPressed && leftInteractPressed)
    {
      leftInteractPressed = false;
      OnInteractRelease(ETrackedControllerRole.LeftHand);
    }
    var rightPressed = inputActions["/actions/hidden/in/OverlayInteract"].Any(
      device => device.Role == ETrackedControllerRole.RightHand
    );
    if (rightPressed && !rightInteractPressed)
    {
      rightInteractPressed = true;
      OnInteractPress(ETrackedControllerRole.RightHand);
    }
    else if (!rightPressed && rightInteractPressed)
    {
      rightInteractPressed = false;
      OnInteractRelease(ETrackedControllerRole.RightHand);
    }
  }

  private void OnInteractRelease(ETrackedControllerRole e)
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
      if (pointer.LastActiveOverlay == null || pointer.LastUvPosition == null) return;
      var browser = pointer.LastActiveOverlay.Browser;
      if (browser != null)
      {
        var x = (int)(pointer.LastUvPosition.Value.X * browser.Size.Width);
        var y = (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height);
        browser.GetBrowser().GetHost().SendMouseClickEvent(x, y,
          MouseButtonType.Left, true, 1, CefEventFlags.None);
      }
    }
  }

  private void OnInteractPress(ETrackedControllerRole e)
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
      if (browser != null)
      {
        var x = (int)(pointer.LastUvPosition.Value.X * browser.Size.Width);
        var y = (int)((1.0f - pointer.LastUvPosition.Value.Y) * browser.Size.Height);
        browser.GetBrowser().GetHost().SendMouseClickEvent(x, y,
          MouseButtonType.Left, false, 1, CefEventFlags.None);
      }
    }
  }

  protected class PointerData {
    public ulong OverlayHandle;
    public Vector2? LastUvPosition;
    public bool Pressed;
    public BaseWebOverlay? LastActiveOverlay;
    public Vector3? LastPosition;
  }
}

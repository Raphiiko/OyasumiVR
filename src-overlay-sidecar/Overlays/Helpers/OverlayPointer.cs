using System.Numerics;
using System.Runtime.InteropServices;
using CefSharp;
using Valve.VR;
using CefEventFlags = CefSharp.CefEventFlags;
using MouseButtonType = CefSharp.MouseButtonType;

namespace overlay_sidecar;

public class OverlayPointer {
  private readonly List<BaseWebOverlay> _overlays = new();
  private volatile bool _disposed;
  private readonly Dictionary<BaseWebOverlay, PointerData> _mouseOwners = new();
  private readonly PointerData _rightPointer;
  private readonly PointerData _leftPointer;

  public OverlayPointer()
  {
    // create the visual pointers
    _rightPointer = new PointerData()
    {
      LastUvPosition = Vector2.Zero
    };
    OvrUtils.getOrCreateOverlay(
      "co.raphii.oyasumivr:PointerRight", "OyasumiVR Right Pointer", ref _rightPointer.OverlayHandle);
    OpenVR.Overlay.SetOverlayWidthInMeters(_rightPointer.OverlayHandle, 0.02f);
    _leftPointer = new PointerData()
    {
      LastUvPosition = Vector2.Zero
    };
    OvrUtils.getOrCreateOverlay(
      "co.raphii.oyasumivr:PointerLeft", "OyasumiVR Left Pointer", ref _leftPointer.OverlayHandle);
    OpenVR.Overlay.SetOverlayWidthInMeters(_leftPointer.OverlayHandle, 0.02f);
    OpenVR.Overlay.SetOverlaySortOrder(_leftPointer.OverlayHandle, 150);
    OpenVR.Overlay.SetOverlaySortOrder(_rightPointer.OverlayHandle, 150);
    // load the pointer texture
    var pointerImage = Utils.ConvertPngToBgra(Utils.LoadEmbeddedFile("oyasumivr-overlay-sidecar.Resources.pointer.png"));
    var intPtr = Marshal.AllocHGlobal(pointerImage.Item1.Length);
    Marshal.Copy(pointerImage.Item1, 0, intPtr, pointerImage.Item1.Length);
    OpenVR.Overlay.SetOverlayRaw(_rightPointer.OverlayHandle, intPtr, (uint)pointerImage.Item2,
      (uint)pointerImage.Item3, 4);
    OpenVR.Overlay.SetOverlayRaw(_leftPointer.OverlayHandle, intPtr, (uint)pointerImage.Item2,
      (uint)pointerImage.Item3, 4);
    Marshal.FreeHGlobal(intPtr);
    // start input and pose updates
    OvrManager.Instance.OnInputActionsChanged += OnInputAction;
    new Thread(Start).Start();
  }


  public void Dispose()
  {
    lock (_overlays)
    {
      if (_disposed) return;
      _disposed = true;
      OvrManager.Instance.OnInputActionsChanged -= OnInputAction;
      LeaveOverlay(_leftPointer);
      LeaveOverlay(_rightPointer);
      _overlays.Clear();
      OpenVR.Overlay.DestroyOverlay(_leftPointer.OverlayHandle);
      OpenVR.Overlay.DestroyOverlay(_rightPointer.OverlayHandle);
    }
  }

  public void StartForOverlay(BaseWebOverlay overlay)
  {
    lock (_overlays)
    {
      if (!_disposed && !_overlays.Contains(overlay)) _overlays.Add(overlay);
    }
  }

  public void StopForOverlay(BaseWebOverlay overlay)
  {
    lock (_overlays)
    {
      if (_disposed) return;
      _overlays.Remove(overlay);
      if (_leftPointer.LastActiveOverlay == overlay) LeaveOverlay(_leftPointer);
      if (_rightPointer.LastActiveOverlay == overlay) LeaveOverlay(_rightPointer);
    }
  }

  public Vector3? GetPointerLocationForOverlay(BaseWebOverlay overlay)
  {
    lock (_overlays)
    {
      return _mouseOwners.TryGetValue(overlay, out var owner) ? owner.LastPosition : null;
    }
  }

  private void Start()
  {
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
      lock (_overlays)
      {
        if (_disposed) break;

        // find controller intersections
        intersections.Clear();
        foreach (var controllerRole in controllerRoles)
        {
          var controllerPose = OvrUtils.GetControllerPose(controllerRole, poseBuffer);
          if (controllerPose is not { bPoseIsValid: true } || !controllerPose.Value.bDeviceIsConnected) continue;
          foreach (var overlay in _overlays)
          {
            var controllerTransform = Matrix4x4.CreateRotationX(345f) *
                                      controllerPose.Value.mDeviceToAbsoluteTracking.ToMatrix4X4();
            intersectionParams.eOrigin = ETrackingUniverseOrigin.TrackingUniverseStanding;
            intersectionParams.vSource = controllerTransform.Translation.ToHmdVector3_t();
            intersectionParams.vDirection = controllerTransform.GetDirectionNormal().ToHmdVector3_t();
            if (!OpenVR.Overlay.ComputeOverlayIntersection(overlay.OverlayHandle, ref intersectionParams,
                  ref intersectionResults)) continue;
            if (intersectionResults.vUVs.v0 < 0 || intersectionResults.vUVs.v0 > 1 ||
                intersectionResults.vUVs.v1 < 0 || intersectionResults.vUVs.v1 > 1) continue;
            intersections.Add((intersectionResults, controllerRole, overlay));
          }
        }

        // select the nearest overlay per hand
        closestIntersections[0] = null;
        closestIntersections[1] = null;
        foreach (var intersection in intersections)
        {
          var index = intersection!.Value.Item2 == ETrackedControllerRole.LeftHand ? 0 : 1;
          if (!closestIntersections[index].HasValue ||
              closestIntersections[index]!.Value.Item1.fDistance > intersection.Value.Item1.fDistance)
            closestIntersections[index] = (intersection.Value.Item1, intersection.Value.Item3);
        }

        var headTransform = OvrUtils.GetHeadPose(poseBuffer).mDeviceToAbsoluteTracking.ToMatrix4X4();

        // update both hits before choosing browser owners
        foreach (var (intersection, pointer) in new[]
                 { (closestIntersections[0], _leftPointer), (closestIntersections[1], _rightPointer) })
        {
          if (pointer.LastActiveOverlay != intersection?.Item2) LeaveOverlay(pointer);
          if (!intersection.HasValue) continue;

          var position = intersection.Value.Item1.vPoint.ToVector3();
          var transform = (Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headTransform)) *
                           Matrix4x4.CreateTranslation(position)).ToHmdMatrix34_t();
          OpenVR.Overlay.SetOverlayTransformAbsolute(pointer.OverlayHandle,
            ETrackingUniverseOrigin.TrackingUniverseStanding, ref transform);
          OpenVR.Overlay.ShowOverlay(pointer.OverlayHandle);
          pointer.LastUvPosition = intersection.Value.Item1.vUVs.ToVector2();
          pointer.LastActiveOverlay = intersection.Value.Item2;
          pointer.LastPosition = position;
        }

        foreach (var pointer in new[] { _leftPointer, _rightPointer })
        {
          if (pointer.LastActiveOverlay is not { } overlay) continue;
          _mouseOwners.TryAdd(overlay, pointer);
          if (_mouseOwners[overlay] == pointer) MoveMouse(pointer);
        }
      }

      timer.SleepUntilNextTick();
    }
  }

  private void OnInputAction(object? sender, Dictionary<string, List<OvrManager.OvrInputDevice>> inputActions)
  {
    lock (_overlays)
    {
      if (_disposed || !inputActions.TryGetValue(OverlayInteractionInput.Action, out var devices)) return;
      var leftHeld = devices.Any(device => device.Role == ETrackedControllerRole.LeftHand);
      var rightHeld = devices.Any(device => device.Role == ETrackedControllerRole.RightHand);

      // release before accepting a handoff in the same input update
      if (!leftHeld) Release(_leftPointer);
      if (!rightHeld) Release(_rightPointer);
      if (leftHeld) Press(_leftPointer);
      if (rightHeld) Press(_rightPointer);
    }
  }

  private void Press(PointerData pointer)
  {
    if (pointer.TriggerHeld) return;
    pointer.TriggerHeld = true;
    if (pointer.LastActiveOverlay is not { Browser: not null } overlay) return;
    if (_mouseOwners.TryGetValue(overlay, out var owner) && owner.Pressed) return;

    _mouseOwners[overlay] = pointer;
    MoveMouse(pointer);
    pointer.Pressed = true;
    var position = MousePosition(pointer);
    overlay.Browser.GetBrowser().GetHost().SendMouseClickEvent(position.X, position.Y,
      MouseButtonType.Left, false, 1, CefEventFlags.LeftMouseButton);
  }

  private static void Release(PointerData pointer)
  {
    pointer.TriggerHeld = false;
    if (!pointer.Pressed) return;
    pointer.Pressed = false;
    if (pointer.LastActiveOverlay?.Browser is not { } browser) return;

    var position = MousePosition(pointer);
    browser.GetBrowser().GetHost().SendMouseClickEvent(position.X, position.Y,
      MouseButtonType.Left, true, 1, CefEventFlags.None);
  }

  private void LeaveOverlay(PointerData pointer)
  {
    if (pointer.LastActiveOverlay is { } overlay &&
        _mouseOwners.TryGetValue(overlay, out var owner) && owner == pointer)
    {
      if (overlay.Browser is { } browser)
      {
        var host = browser.GetBrowser().GetHost();
        if (pointer.Pressed)
        {
          host.SendMouseClickEvent(-1, -1, MouseButtonType.Left, true, 1, CefEventFlags.None);
          host.SendCaptureLostEvent();
        }
        host.SendMouseMoveEvent(-1, -1, true, CefEventFlags.None);
      }
      _mouseOwners.Remove(overlay);
    }

    OpenVR.Overlay.HideOverlay(pointer.OverlayHandle);
    pointer.Pressed = false;
    pointer.LastPosition = null;
    pointer.LastUvPosition = null;
    pointer.LastActiveOverlay = null;
  }

  private static void MoveMouse(PointerData pointer)
  {
    if (pointer.LastActiveOverlay?.Browser is not { } browser) return;
    var position = MousePosition(pointer);
    browser.GetBrowser().GetHost().SendMouseMoveEvent(position.X, position.Y, false,
      pointer.Pressed ? CefEventFlags.LeftMouseButton : CefEventFlags.None);
  }

  private static (int X, int Y) MousePosition(PointerData pointer)
  {
    var browser = pointer.LastActiveOverlay!.Browser!;
    var uv = pointer.LastUvPosition!.Value;
    return ((int)(uv.X * browser.Size.Width), (int)((1.0f - uv.Y) * browser.Size.Height));
  }

  protected class PointerData {
    public ulong OverlayHandle;
    public Vector2? LastUvPosition;
    public bool TriggerHeld;
    public bool Pressed;
    public BaseWebOverlay? LastActiveOverlay;
    public Vector3? LastPosition;
  }
}

using System.Numerics;
using System.Runtime.InteropServices;
using CefSharp;
using OVRSharp;
using Valve.VR;
using CefEventFlags = CefSharp.CefEventFlags;
using MouseButtonType = CefSharp.MouseButtonType;

namespace overlay_sidecar;

public class OverlayPointer {
  private List<BaseOverlay> _overlays = new();
  private bool _disposed;
  private PointerData _rightPointer;
  private PointerData _leftPointer;

  public OverlayPointer()
  {
    _rightPointer = new PointerData()
    {
      Overlay = new Overlay("co.raphii.oyasumi:PointerRight", "OyasumiVR Right Pointer", false)
      {
        WidthInMeters = 0.01f
      },
      LastUVPosition = Vector2.Zero
    };
    _leftPointer = new PointerData()
    {
      Overlay = new Overlay("co.raphii.oyasumi:PointerLeft", "OyasumiVR Left Pointer", false)
      {
        WidthInMeters = 0.01f
      },
      LastUVPosition = Vector2.Zero
    };

    var color = new byte[] { 0, 128, 255, 255 };
    IntPtr intPtr = Marshal.AllocHGlobal(color.Length);
    Marshal.Copy(color, 0, intPtr, color.Length);
    OpenVR.Overlay.SetOverlayRaw(_rightPointer.Overlay.Handle, intPtr, 1, 1, 4);
    OpenVR.Overlay.SetOverlayRaw(_leftPointer.Overlay.Handle, intPtr, 1, 1, 4);
    Marshal.FreeHGlobal(intPtr);

    OVRManager.Instance.ButtonDetector!.OnTriggerPress += OnTriggerPress;
    OVRManager.Instance.ButtonDetector!.OnTriggerRelease += OnTriggerRelease;

    new Thread(Start).Start();
    new Thread(ProcessMouseMovement).Start();
  }


  public void Dispose()
  {
    if (_disposed) return;
    OVRManager.Instance.ButtonDetector!.OnTriggerPress -= OnTriggerPress;
    OVRManager.Instance.ButtonDetector!.OnTriggerRelease -= OnTriggerRelease;
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
    while (!_disposed)
    {
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
            var controllerTransform = controllerPose.Value.mDeviceToAbsoluteTracking.ToMatrix4x4();
            VROverlayIntersectionParams_t intersectionParams = new VROverlayIntersectionParams_t()
            {
              eOrigin = ETrackingUniverseOrigin.TrackingUniverseStanding,
              vSource = controllerTransform.Translation.ToHmdVector3_t(),
              vDirection = controllerTransform.GetDirectionNormal().ToHmdVector3_t(),
            };
            VROverlayIntersectionResults_t intersectionResults = new VROverlayIntersectionResults_t();
            if (!OpenVR.Overlay.ComputeOverlayIntersection(overlay.Overlay.Handle, ref intersectionParams,
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
        {
          if (intersection.HasValue)
          {
            var position = Vector3.Add(intersection.Value.Item1.vPoint.ToVector3(),
              Vector3.Multiply(intersection.Value.Item1.vNormal.ToVector3(), 0.02f));
            pointer.Overlay.Transform =
              (Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(headTransform)) *
               Matrix4x4.CreateTranslation(position)).ToHmdMatrix34_t();
            pointer.Overlay.Show();
            pointer.LastUVPosition = intersection.Value.Item1.vUVs.ToVector2();
            pointer.LastActiveOverlay = intersection.Value.Item3;
            pointer.LastPosition = intersection.Value.Item1.vPoint.ToVector3();
            var browser = intersection.Value.Item3.Browser;
            var x = (int)(pointer.LastUVPosition.Value.X * browser.Size.Width);
            var y = (int)((1.0f - pointer.LastUVPosition.Value.Y) * browser.Size.Height);
            browser.GetBrowser().GetHost().SendMouseMoveEvent(x, y, false,
              pointer.Pressed ? CefEventFlags.LeftMouseButton : CefEventFlags.None);
          }
          else
          {
            pointer.Overlay.Hide();
            if (pointer.LastActiveOverlay != null && pointer.LastUVPosition != null)
            {
              var browser = pointer.LastActiveOverlay!.Browser;
              browser.GetBrowser().GetHost().SendMouseMoveEvent(
                (int)(pointer.LastUVPosition.Value.X * browser.Size.Width),
                (int)((1.0f - pointer.LastUVPosition.Value.Y) * browser.Size.Height),
                true, CefEventFlags.None);
            }

            pointer.LastPosition = null;
            pointer.Pressed = false;
            pointer.LastUVPosition = null;
            pointer.LastActiveOverlay = null;
          }
        }
      }

      Thread.Sleep(TimeSpan.FromMilliseconds(16));
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
      if (pointer.LastActiveOverlay == null || pointer.LastUVPosition == null) return;
      var browser = pointer.LastActiveOverlay.Browser;
      var x = (int)(pointer.LastUVPosition.Value.X * browser.Size.Width);
      var y = (int)((1.0f - pointer.LastUVPosition.Value.Y) * browser.Size.Height);
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
      if (pointer.LastActiveOverlay == null || pointer.LastUVPosition == null) return;
      var browser = pointer.LastActiveOverlay.Browser;
      var x = (int)(pointer.LastUVPosition.Value.X * browser.Size.Width);
      var y = (int)((1.0f - pointer.LastUVPosition.Value.Y) * browser.Size.Height);
      browser.GetBrowser().GetHost().SendMouseClickEvent(x, y,
        MouseButtonType.Left, false, 1, CefEventFlags.None);
    }
  }

  protected class PointerData {
    public Overlay Overlay;
    public Vector2? LastUVPosition;
    public bool Pressed;
    public BaseOverlay? LastActiveOverlay;
    public Vector3? LastPosition;
  }
}

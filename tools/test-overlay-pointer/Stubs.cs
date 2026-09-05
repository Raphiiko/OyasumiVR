using System.Numerics;
using CefSharp.OffScreen;
using Valve.VR;

namespace Serilog
{
  public static class Log
  {
    public static void Error(string message, params object[] values) => Console.Error.WriteLine(message);
  }
}

namespace Valve.VR
{
  public enum ETrackedControllerRole { Invalid, LeftHand, RightHand }
  public enum ETrackingUniverseOrigin { TrackingUniverseStanding }
  public enum EVRInputError { None, InvalidHandle }
  public struct HmdMatrix34_t { public Matrix4x4 Value; }
  public struct HmdVector3_t { public Vector3 Value; }
  public struct HmdVector2_t { public float v0, v1; }
  public struct TrackedDevicePose_t
  {
    public bool bPoseIsValid, bDeviceIsConnected;
    public HmdMatrix34_t mDeviceToAbsoluteTracking;
  }
  public struct VROverlayIntersectionParams_t
  {
    public ETrackingUniverseOrigin eOrigin;
    public HmdVector3_t vSource, vDirection;
  }
  public struct VROverlayIntersectionResults_t
  {
    public HmdVector2_t vUVs;
    public HmdVector3_t vPoint;
    public float fDistance;
  }
  public struct InputDigitalActionData_t { public bool bActive, bState, bChanged; }
  public static class OpenVR
  {
    public const int k_unMaxTrackedDeviceCount = 3;
    public static readonly FakeOverlay Overlay = new();
    public static readonly CVRInput Input = new();
    public static readonly CVRSystem System = new();
  }
  public class CVRInput
  {
    public readonly HashSet<ETrackedControllerRole> Held = new();
    public readonly HashSet<ETrackedControllerRole> Inactive = new();
    public EVRInputError GetInputSourceHandle(string path, ref ulong handle)
    {
      handle = path switch { "/user/hand/left" => 1, "/user/hand/right" => 2, _ => 0 };
      return handle == 0 ? EVRInputError.InvalidHandle : EVRInputError.None;
    }
    public EVRInputError GetDigitalActionData(ulong action, ref InputDigitalActionData_t data, uint size, ulong source)
    {
      if (source is not (1 or 2)) throw new Exception("Overlay actions must be read separately for each hand");
      var role = (ETrackedControllerRole)source;
      data = new() { bActive = !Inactive.Contains(role), bState = Held.Contains(role), bChanged = false };
      return EVRInputError.None;
    }
  }
  public class CVRSystem
  {
    public uint GetTrackedDeviceIndexForControllerRole(ETrackedControllerRole role) => (uint)role;
  }
  public class FakeOverlay
  {
    public readonly HashSet<ulong> Visible = new();
    public void SetOverlayWidthInMeters(ulong handle, float width) { }
    public void SetOverlaySortOrder(ulong handle, int order) { }
    public void SetOverlayRaw(ulong handle, IntPtr data, uint width, uint height, int depth) { }
    public void DestroyOverlay(ulong handle) => Visible.Remove(handle);
    public void SetOverlayTransformAbsolute(ulong handle, ETrackingUniverseOrigin origin, ref HmdMatrix34_t transform) { }
    public void ShowOverlay(ulong handle) => Visible.Add(handle);
    public void HideOverlay(ulong handle) => Visible.Remove(handle);
    public bool ComputeOverlayIntersection(ulong handle, ref VROverlayIntersectionParams_t ray,
      ref VROverlayIntersectionResults_t hit)
    {
      var hand = ray.vSource.Value.X < 0 ? overlay_sidecar.OvrUtils.Left : overlay_sidecar.OvrUtils.Right;
      if (hand.Overlay != handle) return false;
      hit = new()
      {
        vUVs = new() { v0 = hand.X, v1 = 0.5f },
        vPoint = new() { Value = new(hand.X * 1000, 100, 0) },
        fDistance = 1
      };
      return true;
    }
  }
}

namespace overlay_sidecar
{
  public class BaseWebOverlay
  {
    public ulong OverlayHandle = 42;
    public ChromiumWebBrowser? Browser;
  }
  public class OvrManager
  {
    public static readonly OvrManager Instance = new();
    public event EventHandler<Dictionary<string, List<OvrInputDevice>>>? OnInputActionsChanged;
    private readonly List<OvrInputDevice> _devices = new();
    public class OvrInputDevice(uint id, ETrackedControllerRole role)
    {
      public readonly uint Id = id;
      public readonly ETrackedControllerRole Role = role;
    }
    public void Input(params ETrackedControllerRole[] roles)
    {
      OpenVR.Input.Held.Clear();
      OpenVR.Input.Held.UnionWith(roles);
      Poll();
    }
    public void Poll()
    {
      if (OverlayInteractionInput.Update(OpenVR.Input, OpenVR.System, 1, _devices))
        OnInputActionsChanged?.Invoke(this, new() { [OverlayInteractionInput.Action] = _devices });
    }
  }
  public static class OvrUtils
  {
    public class Hand
    {
      public bool Valid = true;
      public bool Connected = true;
      public ulong Overlay = 42;
      public float X;
    }
    public static readonly Hand Left = new() { X = 0.2f };
    public static readonly Hand Right = new() { X = 0.8f };
    public static TrackedDevicePose_t? GetControllerPose(ETrackedControllerRole role, TrackedDevicePose_t[] poses)
    {
      var hand = role == ETrackedControllerRole.LeftHand ? Left : Right;
      return new()
      {
        bPoseIsValid = hand.Valid, bDeviceIsConnected = hand.Connected,
        mDeviceToAbsoluteTracking = new() { Value = Matrix4x4.CreateTranslation(role == ETrackedControllerRole.LeftHand ? -1 : 1, 0, 0) }
      };
    }
    public static TrackedDevicePose_t GetHeadPose(TrackedDevicePose_t[] poses) =>
      new() { mDeviceToAbsoluteTracking = new() { Value = Matrix4x4.Identity } };
    public static void getOrCreateOverlay(string key, string name, ref ulong handle) =>
      handle = key.EndsWith("Left") ? 1ul : 2ul;
  }
  public static class Utils
  {
    public static byte[] LoadEmbeddedFile(string name) => new byte[4];
    public static (byte[], int, int) ConvertPngToBgra(byte[] bytes) => (bytes, 1, 1);
    public static Matrix4x4 ToMatrix4X4(this HmdMatrix34_t matrix) => matrix.Value;
    public static HmdMatrix34_t ToHmdMatrix34_t(this Matrix4x4 matrix) => new() { Value = matrix };
    public static HmdVector3_t ToHmdVector3_t(this Vector3 vector) => new() { Value = vector };
    public static Vector3 GetDirectionNormal(this Matrix4x4 matrix) => Vector3.UnitZ;
    public static Vector3 ToVector3(this HmdVector3_t vector) => vector.Value;
    public static Vector2 ToVector2(this HmdVector2_t vector) => new(vector.v0, vector.v1);
  }
  public class RefreshRateTimer
  {
    public static readonly SemaphoreSlim Go = new(0), Done = new(0), Waiting = new(0);
    public void TickStart() { Waiting.Release(); Go.Wait(); }
    public void SleepUntilNextTick() => Done.Release();
    public static void Step()
    {
      if (!Waiting.Wait(5000)) throw new Exception("Pointer thread did not reach next frame");
      Go.Release();
      if (!Done.Wait(5000)) throw new Exception("Pointer frame did not complete");
    }
  }
}

using System.Numerics;
using Valve.VR;
using CMath = System.Math;

namespace overlay_sidecar;

public static class MathUtils {
  public static float ToRadians(this float degrees)
  {
    return (int)(degrees * (CMath.PI / 180));
  }

  public static float ToDegrees(this float degrees)
  {
    return (int)(degrees * (180 / CMath.PI));
  }

  public static double ToRadians(this double degrees)
  {
    return (int)(degrees * (CMath.PI / 180));
  }

  public static double ToDegrees(this double degrees)
  {
    return (int)(degrees * (180 / CMath.PI));
  }

  /// <summary>
  /// Converts a <see cref="Matrix4x4"/> to a <see cref="HmdMatrix34_t"/>.
  /// <br/>
  /// <br/>
  /// From: <br/>
  /// 11 12 13 14 <br/>
  /// 21 22 23 24 <br/>
  /// 31 32 33 34 <br/>
  /// 41 42 43 44
  /// <br/><br/>
  /// To: <br/>
  /// 11 21 31 41 <br/>
  /// 12 22 32 42 <br/>
  /// 13 23 33 43
  /// </summary>
  public static HmdMatrix34_t ToHmdMatrix34_t(this Matrix4x4 matrix)
  {
    return new HmdMatrix34_t()
    {
      // row 1
      m0 = matrix.M11,
      m1 = matrix.M21,
      m2 = matrix.M31,
      m3 = matrix.M41,

      // row 2
      m4 = matrix.M12,
      m5 = matrix.M22,
      m6 = matrix.M32,
      m7 = matrix.M42,

      // row 3
      m8 = matrix.M13,
      m9 = matrix.M23,
      m10 = matrix.M33,
      m11 = matrix.M43
    };
  }

  /// <summary>
  /// Converts a <see cref="HmdMatrix34_t"/> to a <see cref="Matrix4x4"/>.
  /// <br/>
  /// <br/>
  /// From: <br/>
  /// 11 12 13 14 <br/>
  /// 21 22 23 24 <br/>
  /// 31 32 33 34
  /// <br/><br/>
  /// To: <br/>
  /// 11 21 31 XX <br/>
  /// 12 22 32 XX <br/>
  /// 13 23 33 XX <br/>
  /// 14 24 34 XX
  /// </summary>
  public static Matrix4x4 ToMatrix4X4(this HmdMatrix34_t matrix)
  {
    return new Matrix4x4(
      matrix.m0, matrix.m4, matrix.m8, 0,
      matrix.m1, matrix.m5, matrix.m9, 0,
      matrix.m2, matrix.m6, matrix.m10, 0,
      matrix.m3, matrix.m7, matrix.m11, 1
    );
  }

  public static Vector3 ToYawPitchRoll(this Quaternion r)
  {
    return new Vector3()
    {
      X = MathF.Atan2(2.0f * (r.Y * r.W + r.X * r.Z), 1.0f - 2.0f * (r.X * r.X + r.Y * r.Y)),
      Y = MathF.Asin(2.0f * (r.X * r.W - r.Y * r.Z)),
      Z = MathF.Atan2(2.0f * (r.X * r.Y + r.Z * r.W), 1.0f - 2.0f * (r.X * r.X + r.Z * r.Z))
    };
  }

  public static HmdVector3_t ToHmdVector3_t(this Vector3 vector)
  {
    return new HmdVector3_t()
    {
      v0 = vector.X,
      v1 = vector.Y,
      v2 = vector.Z
    };
  }

  public static Vector3 ToVector3(this HmdVector3_t vector)
  {
    return new Vector3(vector.v0, vector.v1, vector.v2);
  }

  public static Vector2 ToVector2(this HmdVector2_t vector)
  {
    return new Vector2(vector.v0, vector.v1);
  }

  public static Vector3 GetDirectionNormal(this Matrix4x4 matrix)
  {
    var rotation = Matrix4x4.CreateFromQuaternion(Quaternion.CreateFromRotationMatrix(matrix));
    var offset = Matrix4x4.CreateTranslation(0, 0, -1f);
    return Vector3.Normalize((offset * rotation).Translation);
  }

  public static float Lerp(float v1, float v2, float t)
  {
    return v1 + ((v2 - v1) * t);
  }

  public static float LerpClamped(float v1, float v2, float t)
  {
    t = Math.Clamp(t, 0f, 1f);
    return v1 + ((v2 - v1) * t);
  }

  public static float InvLerp(float v1, float v2, float v)
  {
    return (v - v1) / (v2 - v1);
  }

  public static float InvLerpClamped(float v1, float v2, float v)
  {
    v = Math.Clamp(v, v1, v2);
    return (v - v1) / (v2 - v1);
  }
}

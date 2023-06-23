using System.Numerics;
using Valve.VR;

namespace overlay_sidecar;

public static class Math {
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
            m11 = matrix.M43,
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
    public static Matrix4x4 ToMatrix4x4(this HmdMatrix34_t matrix)
    {
        return new Matrix4x4(
            matrix.m0, matrix.m4, matrix.m8, 0,
            matrix.m1, matrix.m5, matrix.m9, 0,
            matrix.m2, matrix.m6, matrix.m10, 0,
            matrix.m3, matrix.m7, matrix.m11, 1
        );
    }

    public static Matrix4x4 TRS(Vector3 translation, Quaternion rotation, Vector3 scale)
    {
        var translationMatrix = Matrix4x4.CreateTranslation(translation);
        var rotationMatrix = Matrix4x4.CreateFromQuaternion(rotation);
        var scaleMatrix = Matrix4x4.CreateScale(scale);

        return scaleMatrix * rotationMatrix * translationMatrix;
    }

    public static Vector3 GetScale(this Matrix4x4 m)
    {
        return new Vector3(m.M11, m.M22, m.M33);
    }
}
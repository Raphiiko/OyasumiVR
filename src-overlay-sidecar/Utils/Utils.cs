using System.Drawing;
using System.Reflection;
using Serilog;
using SharpDX;
using SharpDX.Direct3D11;
using SharpDX.DXGI;

namespace overlay_sidecar;

public static class Utils {
  public static async Task DelayedAction(Action action, TimeSpan delay)
  {
    await Task.Delay(delay);
    action();
  }

  public static byte[] LoadEmbeddedFile(string embeddedFileName)
  {
    var assembly = Assembly.GetExecutingAssembly();
    using var stream = assembly.GetManifestResourceStream(embeddedFileName);
    if (stream == null) throw new ArgumentException($"Embedded file '{embeddedFileName}' not found.");
    using var memoryStream = new MemoryStream();
    stream.CopyTo(memoryStream);
    return memoryStream.ToArray();
  }

  public static (byte[], uint, uint) ConvertPngToRgba(byte[] pngData)
  {
    using (var stream = new MemoryStream(pngData))
    using (var bitmap = new Bitmap(stream))
    {
      var rgbaData = new byte[bitmap.Width * bitmap.Height * 4];
      var index = 0;

      for (var y = 0; y < bitmap.Height; y++)
      for (var x = 0; x < bitmap.Width; x++)
      {
        var color = bitmap.GetPixel(x, y);
        rgbaData[index++] = color.R;
        rgbaData[index++] = color.G;
        rgbaData[index++] = color.B;
        rgbaData[index++] = color.A;
      }

      return (rgbaData, (uint)bitmap.Width, (uint)bitmap.Height);
    }
  }

  public static async Task<Texture2D> InitTexture2D(uint resolution)
  {
    var timings = new[] { 16, 100, 200, 500, 1000 };
    Texture2D? texture = null;
    for (var attempt = 0;; attempt++)
    {
      try
      {
        texture = new Texture2D(
          OvrManager.Instance.D3D11Device,
          new Texture2DDescription
          {
            Width = (int)resolution,
            Height = (int)resolution,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.R8G8B8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Dynamic,
            BindFlags = BindFlags.ShaderResource,
            CpuAccessFlags = CpuAccessFlags.Write
          }
        );
      }
      catch (SharpDXException err)
      {
        if (attempt >= timings.Length)
        {
          Log.Error("Could not create overlay: " + err);
          texture?.Dispose();
          GC.Collect();
          throw new Exception("Could not create texture");
        }

        await Task.Delay(timings[attempt]);
        continue;
      }

      break;
    }

    return texture;
  }
}

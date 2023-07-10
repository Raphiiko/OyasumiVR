using System.Drawing;
using System.Reflection;

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

  public static (byte[], int, int) ConvertPngToRgba(byte[] pngData)
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

      return (rgbaData, bitmap.Width, bitmap.Height);
    }
  }
}

namespace overlay_sidecar;

using System;
using System.Runtime.InteropServices;

public static class WinApi {
  [DllImport("kernel32.dll", SetLastError = false, EntryPoint = "RtlMoveMemory")]
  public static extern void RtlMoveMemory(IntPtr destination, IntPtr source, uint length);

  [DllImport("kernel32.dll", SetLastError = false)]
  public static extern void RtlCopyMemory(IntPtr destination, IntPtr source, uint length);
}

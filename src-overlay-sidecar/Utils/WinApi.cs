namespace overlay_sidecar;

using System;
using System.Runtime.InteropServices;

public static class WinApi {
  [DllImport("kernel32.dll", SetLastError = false, EntryPoint = "RtlMoveMemory")]
  public static extern void CopyMemory(IntPtr destination, IntPtr source, uint length);
}

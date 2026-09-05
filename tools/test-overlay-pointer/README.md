# Overlay pointer regression probe

Run on Windows with the .NET 10 SDK, from the repository root:

```powershell
dotnet run --project tools/test-overlay-pointer/Probe.csproj
```

The probe compiles the production pointer and per-hand input polling code. It sends events
to real CefSharp offscreen browsers using simulated OpenVR poses, intersections, and actions.
It loads the production brightness and color-temperature slider methods with signal and geometry
stand-ins. It requires no SteamVR session and does not launch OyasumiVR or change device settings.

Checks cover clicks and drags from either hand, hover and tooltip ownership, overlapping presses,
independent browsers, tracking loss, hand switching, closure, and disposal. Any failed assertion
returns exit code 1. Browser caches use a unique directory under the system temporary directory.

Physical two-controller verification in the real overlay remains required. This probe does not
validate SteamVR's tracking or binding behavior, the complete Angular UI, or visible pointer textures.

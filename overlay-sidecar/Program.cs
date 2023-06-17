// See https://aka.ms/new-console-template for more information

using CefSharp;
using CefSharp.OffScreen;
using CefSharp.SchemeHandler;
using overlay_sidecar;

public static class Program {
    public static OVRManager OVRManager;
    public static IPCManager IPCManager;
    public static bool GPUFix = false;

    public static void Main(string[] args)
    {
        // Parse args
        if (args.Length == 0 || !int.TryParse(args[0], out var mainProcessPort))
        {
            Console.Error.WriteLine("Usage: oyasumivr-overlay-sidecar.exe <main process port>");
            return;
        }

        // Initialize
        InitCef();
        OVRManager = new OVRManager();
        IPCManager = new IPCManager(mainProcessPort);
    }

    private static void InitCef()
    {
        var settings = new CefSettings();
        settings.RegisterScheme(new CefCustomScheme
        {
            SchemeName = "oyasumivroverlay",
            DomainName = "ui",
            SchemeHandlerFactory = new FolderSchemeHandlerFactory(
                rootFolder: @"C:\Users\Raph\Development\Personal\OyasumiVR_Overlay\oyasumivr-overlay-web\build",
                hostName: "ui",
                defaultPage: "index.html" // will default to index.html
            )
        });
        Cef.Initialize(settings);
    }
}
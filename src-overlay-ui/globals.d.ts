import type {
  OyasumiOverlayIPCIn,
  OyasumiOverlayIPCOut,
  OyasumiOverlayIPCOut_Dashboard,
} from './app/ipc/oyasumi-ipc';

declare global {
  interface Window {
    OyasumiIPCIn: OyasumiOverlayIPCIn;
    OyasumiIPCOut: OyasumiOverlayIPCOut;
    OyasumiIPCOut_Dashboard: OyasumiOverlayIPCOut_Dashboard;

    // Injected by CefSharp when the UI runs inside the overlay sidecar's browser.
    CefSharp?: { BindObjectAsync(name: string): Promise<void> };
  }
}

export {};

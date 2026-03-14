import type {
	OyasumiOverlayIPCIn,
	OyasumiOverlayIPCOut,
	OyasumiOverlayIPCOut_Dashboard
} from '$lib/models/OyasumiOverlayIPC';

declare global {
	interface Window {
		OyasumiIPCIn: OyasumiOverlayIPCIn;
		OyasumiIPCOut: OyasumiOverlayIPCOut;
		OyasumiIPCOut_Dashboard: OyasumiOverlayIPCOut_Dashboard;

		CefSharp: any;
	}
}

export {};

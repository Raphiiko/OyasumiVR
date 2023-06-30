import type { OyasumiOverlayIPCIn } from '$lib/models/OyasumiOverlayIPC';

declare global {
	declare interface Window {
		OyasumiIPCIn: OyasumiOverlayIPCIn;
		OyasumiIPCOut: OyasumiOverlayIPCOut;
		OyasumiIPCOut_Dashboard: OyasumiOverlayIPCOutDashboard;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		CefSharp: any;
	}
}

export {};

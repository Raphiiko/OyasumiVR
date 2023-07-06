import { browser } from '$app/environment';
import type { AddNotificationParams } from '$lib/models/AddNotificationParams';
import type { VRCStatus } from '$lib/models/VRCStatus';
import { tick } from 'svelte';
import { derived, readable, writable } from 'svelte/store';

if (browser && !window.OyasumiIPCIn)
	window.OyasumiIPCIn = Object.assign(window.OyasumiIPCIn || {}, {});

class IPCService {
	events = {
		// Notification events
		addNotification: readable<AddNotificationParams | null>(null, (set) => {
			if (!browser) return;
			window.OyasumiIPCIn.addNotification = async (notification: AddNotificationParams) => {
				if (!notification.id) notification.id = Math.random().toString(36);
				set(notification);
				await tick();
				set(null);
				return notification.id;
			};
		}),
		clearNotification: writable<string | null>(null, (set) => {
			if (!browser) return;
			window.OyasumiIPCIn.clearNotification = async (notificationId: string) => {
				set(notificationId);
				await tick();
				set(null);
			};
		}),
		// Tooltip Events
		showToolTip: writable<string | null>(null, (set) => {
			if (!browser) return;
			window.OyasumiIPCIn.showToolTip = async (tooltip: string | null) => {
				set(tooltip);
			};
		})
	};

	sleepMode = writable<boolean>(false, (set) => {
		if (!browser) return;
		window.OyasumiIPCIn.setSleepMode = async (mode: boolean) => set(mode);
	});
	vrcStatus = writable<VRCStatus>('Offline', (set) => {
		if (!browser) return;
		window.OyasumiIPCIn.setVRCStatus = async (status: VRCStatus) => set(status);
	});
	vrcUsername = writable<string | null>(null, (set) => {
		if (!browser) return;
		window.OyasumiIPCIn.setVRCUsername = async (username: string | null) =>
			set(username ? username : null);
	});
	vrcLoggedIn = derived(
		[this.vrcUsername, this.vrcStatus],
		([$username, $status]) => $username !== null && $status !== 'Offline'
	);

	async init() {
		if (!browser || !window.CefSharp) return;
		await window.CefSharp.BindObjectAsync('OyasumiIPCOut');
	}

	async setSleepMode(mode: boolean) {
		if (!browser) return;
		this.sleepMode.set(mode);
		console.log('SETTING SLEEP MODE', mode);
		// TODO: CALL OUT IPC METHOD
	}
}

export default new IPCService();

import type { AddNotificationParams } from './AddNotificationParams';
import type { VRCStatus } from './VRCStatus';

export interface OyasumiOverlayIPCIn {
	// Globals
	setSleepMode(enabled: boolean): Promise<void>;
	setVRCStatus(status: VRCStatus): Promise<void>;
	setVRCUsername(username: string | null): Promise<void>;
	// Dashboard specific
	hideDashboard(): Promise<void>;
	showDashboard(): Promise<void>;
	// Tooltip Specific
	showToolTip(tooltip: string | null): Promise<void>;
	// Notification specific
	addNotification(params: AddNotificationParams): Promise<string>;
	clearNotification(id: string): Promise<void>;
}

export interface OyasumiOverlayIPCOut {
	setSleepMode(enabled: boolean): Promise<void>;
	onUiReady(): Promise<void>;
}

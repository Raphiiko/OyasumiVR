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
  sendEventString(eventName: string, data: string): Promise<void>;
  sendEventBool(eventName: string, data: boolean): Promise<void>;
  sendEventInt(eventName: string, data: number): Promise<void>;
  sendEventDouble(eventName: string, data: number): Promise<void>;
  sendEventJson(eventName: string, data: string): Promise<void>;
  sendEvent(eventName: string, data: string | boolean | number): Promise<void>;
}

export interface OyasumiOverlayIPCOut_Dashboard {
  onUiReady(): Promise<void>;
}

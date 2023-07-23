import type { AddNotificationParams } from "./AddNotificationParams";

export interface OyasumiOverlayIPCIn {
  // Dashboard Specific
  hideDashboard(): Promise<void>;

  showDashboard(): Promise<void>;

  // Tooltip Specific
  showToolTip(tooltip: string | null): Promise<void>;

  // Notification Specific
  addNotification(params: AddNotificationParams): Promise<string>;

  clearNotification(id: string): Promise<void>;

  // State
  setState(b64state: string): Promise<void>;
}

export interface OyasumiOverlayIPCOut {
  setSleepMode(enabled: boolean): Promise<void>;

  onUiReady(): Promise<void>;

  syncState(): Promise<void>;

  sendEventVoid(eventName: string): Promise<void>;

  sendEventString(eventName: string, data: string): Promise<void>;

  sendEventBool(eventName: string, data: boolean): Promise<void>;

  sendEventInt(eventName: string, data: number): Promise<void>;

  sendEventDouble(eventName: string, data: number): Promise<void>;

  sendEventJson(eventName: string, data: string): Promise<void>;

  sendEvent(eventName: string, data: string | boolean | number): Promise<void>;

  addNotification(message: string, duration: number): Promise<string | null>;

  showToolTip(tooltip: string | null): Promise<void>;

  dispose(): Promise<void>;

  getDebugTranslations(): Promise<string>;
}

export interface OyasumiOverlayIPCOut_Dashboard {
  close(): Promise<void>;
}

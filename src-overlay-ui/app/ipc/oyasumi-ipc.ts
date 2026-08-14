export interface AddNotificationParams {
  id?: string;
  message: string;
  duration: number;
}

/** Functions the sidecar calls on the UI. */
export interface OyasumiOverlayIPCIn {
  hideDashboard(): Promise<void>;

  showDashboard(): Promise<void>;

  showToolTip(tooltip: string | null): Promise<void>;

  addNotification(params: AddNotificationParams): Promise<string>;

  clearNotification(id: string): Promise<void>;

  setState(b64state: string): Promise<void>;
}

/** Functions the UI calls on the sidecar. Bound by CefSharp as `OyasumiIPCOut`. */
export interface OyasumiOverlayIPCOut {
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

/** Bound by CefSharp as `OyasumiIPCOut_Dashboard`, only on the dashboard overlay. */
export interface OyasumiOverlayIPCOut_Dashboard {
  close(): Promise<void>;
}

import { browser } from "$app/environment";
import type { AddNotificationParams } from "$lib/models/AddNotificationParams";
import { tick } from "svelte";
import { derived, get, writable } from "svelte/store";
import { DEFAULT_OYASUMI_STATE } from "$lib/models/OyasumiState";
import { cloneDeep, mergeWith } from "lodash";
import {
  OyasumiSidecarAutomationsState,
  OyasumiSidecarState,
  VrcStatus
} from "../../../../src-grpc-web-client/overlay-sidecar_pb";
import { loadTranslations } from "$lib/translations";

if (browser && !window.OyasumiIPCIn)
  window.OyasumiIPCIn = Object.assign(window.OyasumiIPCIn || {}, {});

class IPCService {
  initialized = false;
  state = writable<OyasumiSidecarState>(DEFAULT_OYASUMI_STATE);
  vrcLoggedIn = derived(
    [this.state],
    ([state]) => state.vrcUsername !== null && state.vrcStatus !== VrcStatus.Offline
  );
  locale = derived(
    [this.state],
    ([state]) => state.locale
  );
  events = {
    addNotification: writable<AddNotificationParams | null>(null),
    clearNotification: writable<string | null>(null),
    showToolTip: writable<string | null>(null)
  };

  async init() {
    if (!browser || this.initialized) return;
    this.initialized = true;
    // Update the locale
    this.locale.subscribe(async (locale) => {
      await loadTranslations(locale ?? "en", "");
    });
    // Load IPC OUT functions
    if (window.CefSharp) {
      await window.CefSharp.BindObjectAsync("OyasumiIPCOut");
      window.OyasumiIPCOut.sendEvent = async (eventName: string, data: string | boolean | number) => {
        if (typeof data === "string") await window.OyasumiIPCOut.sendEventString(eventName, data);
        else if (typeof data === "boolean") await window.OyasumiIPCOut.sendEventBool(eventName, data);
        else if (Number.isInteger(data)) await window.OyasumiIPCOut.sendEventInt(eventName, data);
        else await window.OyasumiIPCOut.sendEventDouble(eventName, data);
      };
    }
    // Define IPC IN functions
    window.OyasumiIPCIn.setState = async (b64state) => {
      let state = OyasumiSidecarState.fromBinary(Uint8Array.from(window.atob(b64state), (c) => c.charCodeAt(0)));
      state = mergeWith(cloneDeep(DEFAULT_OYASUMI_STATE), cloneDeep(get(INSTANCE.state)), state, (objValue, srcValue) => {
        if (Array.isArray(objValue)) return srcValue;
      });
      this.state.set(state);
    };
    window.OyasumiIPCIn.showToolTip = async (tooltip) => this.events.showToolTip.set(tooltip);
    window.OyasumiIPCIn.clearNotification = async (notificationId: string) => {
      this.events.clearNotification.set(notificationId);
      await tick();
      this.events.clearNotification.set(null);
    };
    window.OyasumiIPCIn.addNotification = async (notification: AddNotificationParams) => {
      if (!notification.id) notification.id = Math.random().toString(36);
      this.events.addNotification.set(notification);
      await tick();
      this.events.addNotification.set(null);
      return notification.id;
    };
    console.log("IPC Initialized");
  }

  async setSleepMode(mode: boolean) {
    if (!browser) return;
    this.state.update((state) => {
      state = cloneDeep(state);
      state.sleepMode = mode;
      return state;
    });
    await window.OyasumiIPCOut.sendEvent("setSleepMode", mode);
  }

  async setAutomationEnabled(automationId: keyof OyasumiSidecarAutomationsState, enabled: boolean) {
    if (!browser) return;
    this.state.update((state) => {
      state = cloneDeep(state);
      Object.assign(state.automations![automationId]!, { enabled });
      return state;
    });
    await window.OyasumiIPCOut.sendEventJson("setAutomationEnabled", JSON.stringify({
      automationId: automationId.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).toUpperCase(),
      enabled
    }));
  }
}

const INSTANCE = new IPCService();
export default INSTANCE;

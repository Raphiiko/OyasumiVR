import { browser } from "$app/environment";
import type { AddNotificationParams } from "$lib/models/AddNotificationParams";
import { tick } from "svelte";
import { derived, get, writable } from "svelte/store";
import { DEFAULT_OYASUMI_STATE } from "$lib/models/OyasumiState";
import { cloneDeep, mergeWith } from "lodash";
import {
  OyasumiSidecarAutomationsState,
  OyasumiSidecarAutomationsState_ShutdownAutomations,
  OyasumiSidecarState,
  VrcStatus
} from "../../../../src-grpc-web-client/overlay-sidecar_pb";
import { loadDebugTranslations, loadTranslations } from "$lib/translations";
import { fontLoader } from "src-shared-ts/src/font-loader";
import { camelCaseToUpperSnakeCase } from "$lib/utils/string-utils";

if (browser && !window.OyasumiIPCIn)
  window.OyasumiIPCIn = Object.assign(window.OyasumiIPCIn || {}, {});

class IPCService {
  initialized = false;
  state = writable<OyasumiSidecarState>(DEFAULT_OYASUMI_STATE);
  vrcLoggedIn = derived(
    [this.state],
    ([state]) => state.vrcUsername !== null && state.vrcStatus !== VrcStatus.Offline
  );
  locale = derived([this.state], ([state]) => state.locale);
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
      await Promise.all([
        fontLoader.loadFontsForNewLocale(locale ?? "en"),
        locale === "DEBUG" ? loadDebugTranslations() : loadTranslations(locale ?? "en", "")
      ]);
    });
    // Load IPC OUT functions
    if (window.CefSharp) {
      await window.CefSharp.BindObjectAsync("OyasumiIPCOut");
      window.OyasumiIPCOut.sendEvent = async (
        eventName: string,
        data: string | boolean | number
      ) => {
        if (typeof data === "string") await window.OyasumiIPCOut.sendEventString(eventName, data);
        else if (typeof data === "boolean")
          await window.OyasumiIPCOut.sendEventBool(eventName, data);
        else if (Number.isInteger(data)) await window.OyasumiIPCOut.sendEventInt(eventName, data);
        else await window.OyasumiIPCOut.sendEventDouble(eventName, data);
      };
    }
    // Define IPC IN functions
    window.OyasumiIPCIn.setState = async (b64state) => {
      let state = OyasumiSidecarState.fromBinary(
        Uint8Array.from(window.atob(b64state), (c) => c.charCodeAt(0))
      );
      state = mergeWith(
        cloneDeep(DEFAULT_OYASUMI_STATE),
        cloneDeep(get(INSTANCE.state)),
        state,
        (objValue, srcValue) => {
          if (Array.isArray(objValue)) return srcValue;
        }
      );
      this.state.set(state);
    };
    window.OyasumiIPCIn.showToolTip = async (tooltip) => this.events.showToolTip.set(tooltip);
    window.OyasumiIPCIn.clearNotification = async (notificationId: string) => {
      this.events.clearNotification.set(notificationId);
      await tick();
      this.events.clearNotification.set(null);
    };
    window.OyasumiIPCIn.addNotification = async (
      notification: AddNotificationParams
    ): Promise<string> => {
      if (!notification.id) notification.id = Math.random().toString(36);
      this.events.addNotification.set(notification);
      await tick();
      this.events.addNotification.set(null);
      return notification.id;
    };
    console.log("IPC Initialized");
  }

  // Public functions

  public async addNotification(message: string, duration: number): Promise<string | null> {
    if (!browser) return null;
    return await window.OyasumiIPCOut.addNotification(message, duration);
  }

  public async setSleepMode(mode: boolean) {
    if (!browser) return;
    this.state.update((state) => {
      state = cloneDeep(state);
      state.sleepMode = mode;
      return state;
    });
    await window.OyasumiIPCOut.sendEvent("setSleepMode", mode);
  }

  public async toggleAutomation<
    T extends keyof OyasumiSidecarAutomationsState = keyof OyasumiSidecarAutomationsState
  >(automationId: T) {
    const automations = get(this.state).automations;
    if (!automations) return;
    const state: OyasumiSidecarAutomationsState[T] = automations[automationId];
    let fieldName = "enabled";
    let enabled = false;
    switch (automationId) {
      case "shutdownAutomations": {
        fieldName = "sleepTriggerEnabled";
        enabled = !(state as OyasumiSidecarAutomationsState_ShutdownAutomations)
          .sleepTriggerEnabled;
        break;
      }
      default: {
        enabled = !(state as { enabled: boolean }).enabled;
        break;
      }
    }
    await this.updateAutomation(automationId, {
      [fieldName]: enabled
    } as any);
    await window.OyasumiIPCOut.sendEventJson(
      "setAutomationEnabled",
      JSON.stringify({
        automationId: camelCaseToUpperSnakeCase(automationId),
        enabled
      })
    );
  }

  public async startShutdownSequence() {
    await window.OyasumiIPCOut.sendEventVoid("startShutdownSequence");
  }

  public async turnOffOVRDevices(deviceIds: number[]) {
    await window.OyasumiIPCOut.sendEventJson("turnOffOVRDevices", JSON.stringify(deviceIds));
  }

  public async setBrightness(type: "SIMPLE" | "IMAGE" | "DISPLAY", value: number): Promise<void> {
    this.state.update((state) => {
      state = cloneDeep(state);
      switch (type) {
        case "SIMPLE":
          state.brightnessState!.brightness = value;
          window.OyasumiIPCOut.sendEventDouble("setSimpleBrightness", value);
          break;
        case "IMAGE":
          state.brightnessState!.imageBrightness = value;
          window.OyasumiIPCOut.sendEventDouble("setImageBrightness", value);
          break;
        case "DISPLAY":
          state.brightnessState!.displayBrightness = value;
          window.OyasumiIPCOut.sendEventDouble("setDisplayBrightness", value);
          break;
      }
      return state;
    });
  }

  public async prepareForSleep() {
    await window.OyasumiIPCOut.sendEventVoid("prepareForSleep");
  }

  public async getDebugTranslations(): Promise<any> {
    const str = await window.OyasumiIPCOut.getDebugTranslations();
    if (!str) return {};
    const obj = JSON.parse(str);
    if (typeof obj !== "object") return {};
    return obj;
  }

  // Internals

  private async updateAutomation<
    T extends keyof OyasumiSidecarAutomationsState = keyof OyasumiSidecarAutomationsState
  >(automationId: T, props: Partial<OyasumiSidecarAutomationsState[T]>) {
    if (!browser) return;
    const automations = get(this.state).automations;
    if (!automations) return;
    const _state: OyasumiSidecarAutomationsState[T] = automations[automationId];
    if (!_state) return;
    this.state.update((state) => {
      state = cloneDeep(state);
      Object.assign(_state, props);
      return state;
    });
  }

}

const INSTANCE = new IPCService();
export default INSTANCE;

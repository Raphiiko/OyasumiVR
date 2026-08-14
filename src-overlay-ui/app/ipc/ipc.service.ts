import { computed, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { cloneDeep, mergeWith } from 'lodash';
import {
  OyasumiSidecarAutomationsState,
  OyasumiSidecarAutomationsState_ShutdownAutomations,
  OyasumiSidecarState,
  VrcStatus,
} from 'src-grpc-web-client/overlay-sidecar_pb';
import { DEFAULT_OYASUMI_STATE } from './default-state';
import { AddNotificationParams } from './oyasumi-ipc';
import { camelCaseToUpperSnakeCase } from '../utils/string-utils';

export type BrightnessType = 'SIMPLE' | 'SOFTWARE' | 'HARDWARE';

@Injectable({ providedIn: 'root' })
export class IpcService {
  private readonly _state = signal<OyasumiSidecarState>(DEFAULT_OYASUMI_STATE);
  private readonly _tooltip = signal<string | null>(null);
  private initialized = false;

  readonly state = this._state.asReadonly();
  readonly tooltip = this._tooltip.asReadonly();
  readonly locale = computed(() => this.state().locale ?? 'en');
  readonly vrcLoggedIn = computed(
    () => !!this.state().vrcUsername && this.state().vrcStatus !== VrcStatus.Offline
  );

  readonly notificationAdded = new Subject<AddNotificationParams>();
  readonly notificationCleared = new Subject<string>();

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    window.OyasumiIPCIn = Object.assign(window.OyasumiIPCIn ?? {}, {
      setState: async (b64state: string) => this.applyState(b64state),
      showToolTip: async (tooltip: string | null) => this._tooltip.set(tooltip),
      clearNotification: async (id: string) => this.notificationCleared.next(id),
      addNotification: async (notification: AddNotificationParams) => {
        // An empty id would collide with the next one in the list's track expression.
        if (!notification.id) notification.id = Math.random().toString(36);
        this.notificationAdded.next(notification);
        return notification.id;
      },
    });
  }

  /** Binds the sidecar's outgoing IPC object. Must complete before any `send*` call. */
  async initOutgoingIpc(): Promise<void> {
    if (!window.CefSharp) {
      this.installOutgoingIpcStub();
      return;
    }
    await window.CefSharp.BindObjectAsync('OyasumiIPCOut');
    window.OyasumiIPCOut.sendEvent = async (
      eventName: string,
      data: string | boolean | number
    ): Promise<void> => {
      if (typeof data === 'string') await window.OyasumiIPCOut.sendEventString(eventName, data);
      else if (typeof data === 'boolean') await window.OyasumiIPCOut.sendEventBool(eventName, data);
      else if (Number.isInteger(data)) await window.OyasumiIPCOut.sendEventInt(eventName, data);
      else await window.OyasumiIPCOut.sendEventDouble(eventName, data);
    };
  }

  async addNotification(message: string, duration: number): Promise<string | null> {
    return window.OyasumiIPCOut.addNotification(message, duration);
  }

  async setSleepMode(mode: boolean): Promise<void> {
    this.patchState((state) => {
      state.sleepMode = mode;
    });
    await window.OyasumiIPCOut.sendEvent('setSleepMode', mode);
  }

  async toggleAutomation<T extends keyof OyasumiSidecarAutomationsState>(
    automationId: T
  ): Promise<void> {
    const automation = this.state().automations?.[automationId];
    if (!automation) return;
    const isShutdown = automationId === 'shutdownAutomations';
    const field = isShutdown ? 'triggersEnabled' : 'enabled';
    const enabled = !(isShutdown
      ? (automation as OyasumiSidecarAutomationsState_ShutdownAutomations).triggersEnabled
      : (automation as { enabled: boolean }).enabled);
    this.patchState((state) => {
      Object.assign(state.automations![automationId]!, { [field]: enabled });
    });
    await window.OyasumiIPCOut.sendEventJson(
      'setAutomationEnabled',
      JSON.stringify({ automationId: camelCaseToUpperSnakeCase(automationId), enabled })
    );
  }

  async startShutdownSequence(): Promise<void> {
    await window.OyasumiIPCOut.sendEventVoid('startShutdownSequence');
  }

  async turnOffOVRDevices(deviceIds: number[]): Promise<void> {
    await window.OyasumiIPCOut.sendEventJson('turnOffOVRDevices', JSON.stringify(deviceIds));
  }

  async setBrightness(type: BrightnessType, value: number): Promise<void> {
    this.patchState((state) => {
      const brightness = state.brightnessState;
      if (!brightness) return;
      if (type === 'SIMPLE') brightness.brightness = value;
      else if (type === 'SOFTWARE') brightness.softwareBrightness = value;
      else brightness.hardwareBrightness = value;
    });
    const events: Record<BrightnessType, string> = {
      SIMPLE: 'setSimpleBrightness',
      SOFTWARE: 'setSoftwareBrightness',
      HARDWARE: 'setHardwareBrightness',
    };
    await window.OyasumiIPCOut.sendEventDouble(events[type], value);
  }

  async setColorTemperature(value: number): Promise<void> {
    this.patchState((state) => {
      state.cctState!.value = value;
    });
    await window.OyasumiIPCOut.sendEventDouble('setColorTemperature', value);
  }

  async prepareForSleep(): Promise<void> {
    await window.OyasumiIPCOut.sendEventVoid('prepareForSleep');
  }

  async getDebugTranslations(): Promise<Record<string, unknown> | null> {
    const str = await window.OyasumiIPCOut.getDebugTranslations();
    if (!str) return null;
    try {
      const parsed: unknown = JSON.parse(str);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** Outside the overlay there is no sidecar to bind to, so every outgoing call becomes a no-op. */
  private installOutgoingIpcStub(): void {
    const noop = async (): Promise<void> => undefined;
    window.OyasumiIPCOut = {
      onUiReady: noop,
      syncState: noop,
      sendEventVoid: noop,
      sendEventString: noop,
      sendEventBool: noop,
      sendEventInt: noop,
      sendEventDouble: noop,
      sendEventJson: noop,
      sendEvent: noop,
      showToolTip: noop,
      dispose: noop,
      addNotification: async () => null,
      getDebugTranslations: async () => '',
    };
    window.OyasumiIPCOut_Dashboard = { close: noop };
  }

  private applyState(b64state: string): void {
    const incoming = OyasumiSidecarState.fromBinary(
      Uint8Array.from(window.atob(b64state), (c) => c.charCodeAt(0))
    );
    this._state.set(
      mergeWith(
        cloneDeep(DEFAULT_OYASUMI_STATE),
        cloneDeep(this.state()),
        incoming,
        (objValue: unknown, srcValue: unknown) => (Array.isArray(objValue) ? srcValue : undefined)
      )
    );
  }

  private patchState(mutate: (state: OyasumiSidecarState) => void): void {
    this._state.update((state) => {
      const next = cloneDeep(state);
      mutate(next);
      return next;
    });
  }
}

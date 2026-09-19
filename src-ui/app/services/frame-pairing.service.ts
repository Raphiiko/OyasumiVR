import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { firstValueFrom } from 'rxjs';
import {
  FrameAction,
  FrameCandidate,
  FrameState,
  frameError,
  removedPairing,
} from '../models/frame-pairing';
import { DMKnownDevice } from '../models/device-manager';
import { ModalService } from './modal.service';

@Injectable({ providedIn: 'root' })
export class FramePairingService implements OnDestroy {
  readonly states = signal<FrameState[]>([]);
  readonly unavailable = signal(false);
  readonly notice = signal('');
  readonly active = computed(() => this.states().filter((state) => !removedPairing(state)));
  private ready?: Promise<void>;
  private unlisten?: UnlistenFn;
  private destroyed = false;
  private opening = false;
  private readonly pending = new Set<string>();

  constructor(private modals: ModalService) {}

  init(): Promise<void> {
    return (this.ready ??= this.connect().catch(() => {
      this.unavailable.set(true);
      this.ready = undefined;
    }));
  }

  private async connect() {
    if (!this.unlisten) {
      const unlisten = await listen<FrameState>('frame-pairing-state', ({ payload }) =>
        this.accept(payload)
      );
      if (this.destroyed) {
        unlisten();
        return;
      }
      this.unlisten = unlisten;
    }
    await this.refresh();
  }

  async refresh() {
    const snapshot = await invoke<FrameState[]>('frame_state');
    if (this.destroyed) return;
    snapshot.forEach((state) => this.accept(state));
    this.unavailable.set(false);
  }

  private accept(state: FrameState) {
    if (this.destroyed) return;
    this.states.update((states) => {
      const previous = states.find((item) => item.pairing_id === state.pairing_id);
      if (previous && previous.revision >= state.revision) return states;
      return [...states.filter((item) => item.pairing_id !== state.pairing_id), state];
    });
  }

  forDevice(id: string): FrameState | undefined {
    return this.active().find((state) => state.device_manager_id === id);
  }

  supported(device: DMKnownDevice): boolean {
    return (
      device.deviceType === 'HMD' &&
      (device.typeName === 'Deckard DV2' || !!this.forDevice(device.id))
    );
  }

  async open(device: DMKnownDevice) {
    if (this.opening || this.modals.isModalOpen('frame-pairing')) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const messageCenterTrigger = trigger?.closest('app-message-center-modal')
      ? document.querySelector<HTMLElement>('.btn-message-center')
      : null;
    this.opening = true;
    try {
      await this.init();
      if (!this.unavailable()) await this.refresh().catch(() => this.unavailable.set(true));
      this.modals.closeModal('message-center');
      const { FramePairingComponent } =
        await import('../components/frame-pairing/frame-pairing.component');
      await firstValueFrom(
        this.modals.addModal(
          FramePairingComponent,
          { device },
          {
            id: 'frame-pairing',
            closeOnEscape: false,
            animationDuration: 0,
            wrapperDefaultClass: 'frame-pairing-wrapper',
          }
        )
      );
    } finally {
      this.opening = false;
      const deviceEntry = [...document.querySelectorAll<HTMLElement>('[data-frame-entry]')].find(
        (element) => element.dataset['frameEntry'] === device.id
      );
      (trigger?.isConnected
        ? trigger
        : messageCenterTrigger?.isConnected
          ? messageCenterTrigger
          : deviceEntry
      )?.focus();
    }
  }

  async discover(address?: string) {
    return invoke<FrameCandidate[]>('frame_discover', { address: address?.trim() || null });
  }

  async selectAndPair(device: DMKnownDevice, candidate: FrameCandidate) {
    return this.dispatch(device.id, async () => {
      const pairingId = await invoke<string>('frame_select', {
        deviceManagerId: device.id,
        candidate,
      });
      await invoke<string>('frame_run', { pairingId, action: 'pair' });
    });
  }

  async run(state: FrameState, action: FrameAction) {
    return this.dispatch(state.device_manager_id, () =>
      invoke<string>('frame_run', {
        pairingId: state.pairing_id,
        action,
      })
    );
  }

  async reconnect(state: FrameState, candidate: FrameCandidate) {
    return this.dispatch(state.device_manager_id, () =>
      invoke<string>('frame_reconnect_at', {
        pairingId: state.pairing_id,
        candidate,
      })
    );
  }

  async cancel(state: FrameState) {
    await invoke('frame_cancel', { pairingId: state.pairing_id, operationId: state.operation_id });
    await this.refresh();
  }

  private async dispatch(id: string, action: () => Promise<unknown>) {
    if (this.pending.has(id) || this.forDevice(id)?.in_progress) throw 'busy';
    this.pending.add(id);
    try {
      await this.init();
      if (this.unavailable()) throw 'persistence';
      await action();
      await this.refresh();
    } catch (error) {
      throw frameError(error);
    } finally {
      this.pending.delete(id);
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.unlisten?.();
  }
}

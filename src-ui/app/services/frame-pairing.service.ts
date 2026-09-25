import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { error, info } from '@tauri-apps/plugin-log';
import { BehaviorSubject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { SETTINGS_KEY_FRAME_PAIRING, SETTINGS_STORE } from '../globals';
import { DMKnownDevice } from '../models/device-manager';
import {
  FrameCandidate,
  FrameCleanupOutcome,
  FrameConnectionState,
  FrameFlow,
  FrameIdentity,
  FramePage,
  FramePairing,
  FramePairingData,
  FrameProbeOutcome,
  FrameRegisterOutcome,
  FrameSetupResult,
  FrameSetupStage,
} from '../models/frame';
import { protectSecret, unprotectSecret } from '../utils/secrets';
import { ModalService } from './modal.service';
import { DeviceManagerService } from './device-manager.service';

/** Owns Steam Frame pairing records and runs the pairing wizard's steps. */
@Injectable({
  providedIn: 'root',
})
export class FramePairingService {
  private readonly supportedModels = signal<{ manufacturer: string; model: string }[]>([]);
  private readonly _pairings = signal<FramePairing[]>([]);
  private readonly _connections = signal<Record<string, FrameConnectionState>>({});
  private readonly _flow = signal<FrameFlow | null>(null);
  private cancelRequested = false;
  private setupAttemptId?: string;

  readonly pairings$ = new BehaviorSubject<FramePairing[]>([]);
  readonly connections = this._connections.asReadonly();
  readonly flow = this._flow.asReadonly();
  readonly flowPairing = computed(() => {
    const flow = this._flow();
    return flow ? this.pairingFor(flow.deviceId) : undefined;
  });

  constructor(
    private modalService: ModalService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    this.supportedModels.set(await invoke('frame_supported_models'));
    await this.load();
    await listen<FrameConnectionState>('FRAME_CONNECTION_STATE', (event) =>
      this.onConnectionState(event.payload)
    );
    await listen<{ attemptId: string; stage: FrameSetupStage | 'installed' }>(
      'FRAME_SETUP_STAGE',
      (event) => {
        const { attemptId, stage } = event.payload;
        if (attemptId !== this.setupAttemptId) return;
        const deviceId = this._flow()?.deviceId;
        if (stage !== 'installed') this.patchFlow({ stage });
        else if (deviceId) void this.updatePairing(deviceId, { helperInstalledByPairing: true });
      }
    );
    for (const state of await invoke<FrameConnectionState[]>('frame_connection_states')) {
      this.onConnectionState(state);
    }
    await this.pushPairings();
  }

  isSupported(manufacturer?: string, model?: string): boolean {
    return this.supportedModels().some((m) => m.manufacturer === manufacturer && m.model === model);
  }

  identityOf(device: DMKnownDevice): FrameIdentity | null {
    if (
      !device.id.startsWith('OVR_HMD_') ||
      !this.isSupported(device.manufacturer, device.typeName)
    )
      return null;
    return {
      serial: device.id.substring('OVR_HMD_'.length),
      model: device.typeName,
      manufacturer: device.manufacturer!,
    };
  }

  pairingFor(deviceId: string): FramePairing | undefined {
    return this._pairings().find((p) => p.deviceId === deviceId);
  }

  /** Opens the wizard for the headset SteamVR is using now. Any other headset is ignored. */
  async openWizard(device: DMKnownDevice) {
    const identity = this.identityOf(device);
    if (!identity || !this.deviceManager.isDeviceObserved(device.id)) return;
    if (!this._flow()?.busy) {
      this.cancelRequested = false;
      this._flow.set({
        deviceId: device.id,
        identity,
        page: 'intro',
        candidates: [],
        selected: 0,
        stage: 'verify',
        busy: false,
      });
    }
    if (this.modalService.isModalOpen('frame-pairing')) return;
    const { FramePairingModalComponent } =
      await import('../components/frame-pairing-modal/frame-pairing-modal.component');
    this.modalService
      .addModal(FramePairingModalComponent, undefined, {
        id: 'frame-pairing',
        wrapperDefaultClass: 'modal-wrapper-frame-pairing',
        closeOnEscape: false,
      })
      .subscribe(() => {
        if (!this._flow()?.busy) this._flow.set(null);
      });
  }

  closeWizard() {
    this.modalService.closeModal('frame-pairing');
  }

  go(page: FramePage) {
    this.patchFlow({ page, error: undefined });
  }

  select(index: number) {
    this.patchFlow({ selected: index });
  }

  async discover() {
    this.patchFlow({ page: 'search', manualAddress: undefined, error: undefined, busy: true });
    const candidates = await invoke<FrameCandidate[]>('frame_discover');
    if (this.stopForCancel()) return;
    this.patchFlow({
      busy: false,
      candidates,
      selected: 0,
      page: candidates.length ? 'found' : 'notfound',
    });
  }

  async connectManual(address: string) {
    address = address.trim();
    this.patchFlow({ page: 'search', manualAddress: address, error: undefined, busy: true });
    const user = await invoke<string | null>('frame_login_name', { address });
    if (this.stopForCancel()) return;
    this.patchFlow({
      busy: false,
      candidates: user ? [{ name: address, address }] : [],
      selected: 0,
      page: user ? 'found' : 'notfound',
    });
  }

  /** Starts pairing with the selected headset. Saved access skips the approval prompt. */
  async pair() {
    const flow = this._flow();
    const candidate = flow?.candidates[flow.selected];
    if (!flow || !candidate) return;
    this.patchFlow({ page: 'request', error: undefined, busy: true });
    const user = await invoke<string | null>('frame_login_name', { address: candidate.address });
    if (this.stopForCancel()) return;
    if (!user) return this.patchFlow({ page: 'notfound', busy: false });
    const pairing = await this.preparePairing(flow, candidate.address, user);
    if (!pairing || this.stopForCancel()) return;
    await this.register();
  }

  /** Sends one registration request, unless the saved key already works. Only a user action calls this. */
  async register() {
    const pairing = this.flowPairing();
    if (!pairing) return;
    this.patchFlow({ page: 'request', error: undefined, busy: true });
    const probe = await this.probe(pairing);
    if (this.stopForCancel()) return;
    if (probe.status === 'ok') return this.approved(probe.hostKeyPin);
    if (probe.status === 'hostKeyChanged')
      return this.patchFlow({ page: 'hostKeyChanged', busy: false });
    this.patchFlow({ page: 'awaiting' });
    const outcome = await invoke<FrameRegisterOutcome>('frame_register', {
      address: pairing.address,
      publicKey: pairing.publicKey,
    });
    info(`[FramePairing] Registration: ${outcome}`);
    if (outcome === 'registered' || outcome === 'lost' || outcome === 'failed') {
      await this.updatePairing(pairing.deviceId, { mayBeApproved: true });
      if (this.cancelRequested) return this.finishCancel();
      return this.confirmAccess();
    }
    if (this.stopForCancel()) return;
    const pages: Partial<Record<FrameRegisterOutcome, FramePage>> = {
      declined: 'declined',
      timeout: 'timeout',
      notReady: 'notready',
      unreachable: 'notfound',
    };
    this.patchFlow({ page: pages[outcome] ?? 'uncertain', busy: false });
  }

  /** Checks for access after an approval or an unclear answer, while sshd may still be starting. */
  private async confirmAccess() {
    this.patchFlow({ page: 'request', busy: true });
    const pairing = this.flowPairing();
    if (!pairing) return;
    const probe = await this.probeUntilReady(pairing);
    if (probe.status === 'ok') {
      if (this.cancelRequested) {
        await this.updatePairing(pairing.deviceId, { hostKeyPin: probe.hostKeyPin });
        return this.finishCancel();
      }
      return this.approved(probe.hostKeyPin);
    }
    if (this.stopForCancel()) return;
    if (probe.status === 'hostKeyChanged')
      return this.patchFlow({ page: 'hostKeyChanged', busy: false });
    this.patchFlow({ page: 'uncertain', busy: false });
  }

  /** Probes a few times, because sshd may still be starting right after an approval. */
  private async probeUntilReady(pairing: FramePairing): Promise<FrameProbeOutcome> {
    let probe = await this.probe(pairing);
    for (
      let attempt = 1;
      attempt < 6 && probe.status !== 'ok' && probe.status !== 'hostKeyChanged';
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      probe = await this.probe(pairing);
    }
    return probe;
  }

  private async approved(hostKeyPin: string) {
    const pairing = this.flowPairing();
    if (!pairing) return;
    await this.updatePairing(pairing.deviceId, { hostKeyPin });
    await this.runSetup();
  }

  async runSetup() {
    const pairing = this.flowPairing();
    const flow = this._flow();
    if (!pairing?.hostKeyPin || !flow) return;
    this.setupAttemptId = uuidv4();
    this.patchFlow({ page: 'setup', stage: 'verify', error: undefined, busy: true });
    const result = await invoke<FrameSetupResult>('frame_setup', {
      request: {
        attemptId: this.setupAttemptId,
        access: this.accessOf(pairing),
        pcId: pairing.id,
        token: pairing.token,
        publicKey: pairing.publicKey,
        identity: flow.identity,
      },
    });
    info(`[FramePairing] Setup: ${result.status}`);
    if (result.installed) {
      await this.updatePairing(pairing.deviceId, { helperInstalledByPairing: true });
    }
    if (this.cancelRequested) return this.finishCancel();
    switch (result.status) {
      case 'complete':
        await this.updatePairing(pairing.deviceId, {
          complete: true,
          certPin: result.certPin,
          port: result.port,
          helperVersion: result.helperVersion,
          lastSeen: Date.now(),
        });
        await this.pushPairings();
        return this.patchFlow({ page: 'success', busy: false });
      case 'wrongDevice': {
        this.patchFlow({ page: 'wrongDevice' });
        const outcome = await this.cleanup(pairing, false);
        await this.removePairing(pairing.deviceId);
        this.cancelRequested = false;
        return this.patchFlow({
          page: 'wrongDevice',
          busy: false,
          error: outcome.status === 'done' ? undefined : 'wrongDeviceAccessLeft',
        });
      }
      case 'needsAppUpdate':
        return this.patchFlow({ page: 'needsUpdate', busy: false });
      case 'hostKeyChanged':
        return this.patchFlow({ page: 'hostKeyChanged', busy: false });
      case 'rejected':
        return this.patchFlow({ page: 'accessLost', busy: false });
      default:
        return this.patchFlow({
          page: 'setupFailed',
          busy: false,
          error: {
            identityMissing: 'identityMissing',
            helperBusy: 'helperBusy',
            unreachable: 'offline',
          }[result.status as string],
        });
    }
  }

  /** Stops pairing. A running step finishes first, then this PC's approval is removed. */
  async cancel() {
    const flow = this._flow();
    if (!flow) return;
    if (flow.busy) {
      this.cancelRequested = true;
      return this.patchFlow({ page: 'cancelling', error: undefined });
    }
    await this.finishCancel();
  }

  /** Removes what this attempt left on the headset, then the local pairing. */
  async finishCancel() {
    this.cancelRequested = false;
    let pairing = this.flowPairing();
    if (!pairing || pairing.complete) return this.endFlow();
    this.patchFlow({ page: 'cancelling', error: undefined, busy: true });
    if (!pairing.hostKeyPin && pairing.mayBeApproved) {
      const probe = await this.probeUntilReady(pairing);
      if (probe.status === 'ok') {
        pairing = await this.updatePairing(pairing.deviceId, { hostKeyPin: probe.hostKeyPin });
      } else if (probe.status !== 'rejected') {
        return this.patchFlow({ page: 'cleanupFailed', busy: false });
      }
    }
    if (pairing?.hostKeyPin) {
      const outcome = await this.cleanup(pairing, !!pairing.helperInstalledByPairing);
      if (outcome.status !== 'done') {
        return this.patchFlow({ page: 'cleanupFailed', busy: false });
      }
    }
    await this.removePairing(pairing!.deviceId);
    this.endFlow();
  }

  /** Forgets a cancelled attempt on this PC after cleanup failed. */
  async leaveCleanup() {
    const pairing = this.flowPairing();
    if (pairing && !pairing.complete) await this.removePairing(pairing.deviceId);
    this.endFlow();
  }

  private endFlow() {
    this._flow.set(null);
    this.closeWizard();
  }

  /** Returns true, and finishes the cancellation, when the user cancelled during the last step. */
  private stopForCancel(): boolean {
    if (!this.cancelRequested) return false;
    void this.finishCancel();
    return true;
  }

  private setPairings(pairings: FramePairing[]) {
    this._pairings.set(pairings);
    this.pairings$.next(pairings);
  }

  private patchFlow(patch: Partial<FrameFlow>) {
    const flow = this._flow();
    if (flow) this._flow.set({ ...flow, ...patch });
  }

  private accessOf(pairing: FramePairing) {
    return {
      address: pairing.address,
      user: pairing.user,
      privateKey: pairing.privateKey,
      hostKeyPin: pairing.hostKeyPin ?? null,
    };
  }

  private probe(pairing: FramePairing) {
    return invoke<FrameProbeOutcome>('frame_probe', { access: this.accessOf(pairing) });
  }

  private cleanup(pairing: FramePairing, removeHelper: boolean) {
    return invoke<FrameCleanupOutcome>('frame_cleanup', {
      request: {
        access: this.accessOf(pairing),
        pcId: pairing.id,
        publicKey: pairing.publicKey,
        removeHelper,
      },
    });
  }

  /**
   * Returns the attempt for this headset, saved before any registration. An unfinished attempt
   * keeps its key; a completed pairing is replaced by a new one.
   */
  private async preparePairing(
    flow: FrameFlow,
    address: string,
    user: string
  ): Promise<FramePairing | undefined> {
    const existing = this.pairingFor(flow.deviceId);
    if (existing && !existing.complete) {
      return this.updatePairing(flow.deviceId, { address, user });
    }
    const credentials = await invoke<{ privateKey: string; publicKey: string; token: string }>(
      'frame_create_credentials'
    );
    const pairing: FramePairing = {
      id: uuidv4(),
      deviceId: flow.deviceId,
      identity: flow.identity,
      address,
      user,
      ...credentials,
      complete: false,
    };
    this.setPairings([...this._pairings().filter((p) => p.deviceId !== flow.deviceId), pairing]);
    try {
      await this.save();
    } catch (e) {
      error(`[FramePairing] Could not save the pairing key: ${e}`);
      this.setPairings(this._pairings().filter((p) => p.id !== pairing.id));
      this.patchFlow({ page: 'uncertain', busy: false, error: 'persistence' });
      return undefined;
    }
    await this.pushPairings();
    return pairing;
  }

  private async updatePairing(deviceId: string, patch: Partial<FramePairing>) {
    let updated: FramePairing | undefined;
    this.setPairings(
      this._pairings().map((p) => (p.deviceId === deviceId ? (updated = { ...p, ...patch }) : p))
    );
    await this.save();
    return updated;
  }

  private async removePairing(deviceId: string) {
    this.setPairings(this._pairings().filter((p) => p.deviceId !== deviceId));
    await this.save();
    await this.pushPairings();
  }

  private onConnectionState(state: FrameConnectionState) {
    this._connections.set({ ...this._connections(), [state.pairingId]: state });
    const pairing = this._pairings().find((p) => p.id === state.pairingId);
    if (!pairing) return;
    const patch: Partial<FramePairing> = {};
    if (state.lastSeen && state.lastSeen > (pairing.lastSeen ?? 0)) patch.lastSeen = state.lastSeen;
    if (state.helperVersion && state.helperVersion !== pairing.helperVersion)
      patch.helperVersion = state.helperVersion;
    if (state.address !== pairing.address) patch.address = state.address;
    if (state.certPin !== pairing.certPin) patch.certPin = state.certPin;
    if (Object.keys(patch).length) void this.updatePairing(pairing.deviceId, patch);
  }

  private async pushPairings() {
    const pairings = this._pairings()
      .filter((p) => p.complete && p.hostKeyPin && p.certPin && p.port)
      .map((p) => ({
        id: p.id,
        access: this.accessOf(p),
        port: p.port,
        certPin: p.certPin,
        token: p.token,
        publicKey: p.publicKey,
        identity: p.identity,
      }));
    await invoke('frame_set_pairings', { pairings });
  }

  private async load() {
    const data = await SETTINGS_STORE.get<FramePairingData>(SETTINGS_KEY_FRAME_PAIRING);
    const pairings: FramePairing[] = [];
    for (const stored of data?.pairings ?? []) {
      const privateKey = await unprotectSecret(stored.privateKey);
      const token = await unprotectSecret(stored.token);
      if (!privateKey || !token) {
        error(`[FramePairing] Skipped pairing ${stored.id}: its secrets cannot be read`);
        continue;
      }
      pairings.push({ ...stored, privateKey, token });
    }
    this.setPairings(pairings);
  }

  private saving: Promise<void> = Promise.resolve();

  /** Writes one save at a time, each from the pairings as they are when it starts. */
  private save(): Promise<void> {
    const next = this.saving.catch(() => undefined).then(() => this.write());
    this.saving = next;
    return next;
  }

  private async write() {
    const pairings = await Promise.all(
      this._pairings().map(async (p) => ({
        ...p,
        privateKey: (await protectSecret(p.privateKey))!,
        token: (await protectSecret(p.token))!,
      }))
    );
    await SETTINGS_STORE.set(SETTINGS_KEY_FRAME_PAIRING, {
      version: 1,
      pairings,
    } satisfies FramePairingData);
  }
}

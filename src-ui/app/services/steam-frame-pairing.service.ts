import { Injectable, computed, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { error, info } from '@tauri-apps/plugin-log';
import { BehaviorSubject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { SETTINGS_KEY_STEAM_FRAME_PAIRING, SETTINGS_STORE } from '../globals';
import { DMKnownDevice } from '../models/device-manager';
import {
  SteamFrameCandidate,
  SteamFrameCleanupOutcome,
  SteamFrameConnectionState,
  SteamFrameFlow,
  SteamFrameIdentity,
  SteamFramePage,
  SteamFramePairing,
  SteamFramePairingData,
  SteamFrameProbeOutcome,
  SteamFrameRegisterOutcome,
  SteamFrameSetupResult,
  SteamFrameSetupStage,
} from '../models/steam-frame';
import { protectSecret, unprotectSecret } from '../utils/secrets';
import { ModalService } from './modal.service';
import { DeviceManagerService } from './device-manager.service';

/** Owns Steam Frame pairing records and runs the pairing wizard's steps. */
@Injectable({
  providedIn: 'root',
})
export class SteamFramePairingService {
  private readonly supportedModels = signal<{ manufacturer: string; model: string }[]>([]);
  private readonly _pairings = signal<SteamFramePairing[]>([]);
  private readonly _connections = signal<Record<string, SteamFrameConnectionState>>({});
  private readonly _flow = signal<SteamFrameFlow | null>(null);
  private cancelRequested = false;
  private search = 0;
  private setupAttemptId?: string;

  readonly pairings$ = new BehaviorSubject<SteamFramePairing[]>([]);
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
    this.supportedModels.set(await invoke('steam_frame_get_supported_models'));
    await this.load();
    await listen<SteamFrameConnectionState>('STEAM_FRAME_CONNECTION_STATE', (event) =>
      this.onConnectionState(event.payload)
    );
    await listen<{ attemptId: string; stage: SteamFrameSetupStage | 'installed' }>(
      'STEAM_FRAME_SETUP_STAGE',
      (event) => {
        const { attemptId, stage } = event.payload;
        if (attemptId !== this.setupAttemptId) return;
        const deviceId = this._flow()?.deviceId;
        if (stage !== 'installed') this.patchFlow({ stage });
        else if (deviceId) void this.updatePairing(deviceId, { helperInstalledByPairing: true });
      }
    );
    for (const state of await invoke<SteamFrameConnectionState[]>(
      'steam_frame_get_connection_states'
    )) {
      this.onConnectionState(state);
    }
    await this.pushPairings();
  }

  isSupported(manufacturer?: string, model?: string): boolean {
    return this.supportedModels().some((m) => m.manufacturer === manufacturer && m.model === model);
  }

  identityOf(device: DMKnownDevice): SteamFrameIdentity | null {
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

  pairingFor(deviceId: string): SteamFramePairing | undefined {
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
    if (this.modalService.isModalOpen('steam-frame-pairing')) return;
    const { SteamFramePairingModalComponent } =
      await import('../components/steam-frame-pairing-modal/steam-frame-pairing-modal.component');
    this.modalService
      .addModal(SteamFramePairingModalComponent, undefined, {
        id: 'steam-frame-pairing',
        wrapperDefaultClass: 'modal-wrapper-steam-frame-pairing',
        closeOnEscape: false,
      })
      .subscribe(() => {
        if (!this._flow()?.busy) this._flow.set(null);
      });
  }

  closeWizard() {
    this.modalService.closeModal('steam-frame-pairing');
  }

  go(page: SteamFramePage) {
    this.patchFlow({ page, error: undefined });
  }

  select(index: number) {
    this.patchFlow({ selected: index });
  }

  async discover() {
    const search = ++this.search;
    this.patchFlow({ page: 'search', manualAddress: undefined, error: undefined, busy: true });
    const candidates = await invoke<SteamFrameCandidate[]>('steam_frame_discover_headsets');
    if (this.stopForCancel() || search !== this.search) return;
    this.patchFlow({
      busy: false,
      candidates,
      selected: 0,
      page: candidates.length ? 'found' : 'notfound',
    });
  }

  async connectManual(address: string) {
    address = address.trim();
    const search = ++this.search;
    this.patchFlow({ page: 'search', manualAddress: address, error: undefined, busy: true });
    const user = await invoke<string | null>('steam_frame_get_ssh_user', { address });
    if (this.stopForCancel() || search !== this.search) return;
    this.patchFlow({
      busy: false,
      candidates: user ? [{ name: address, address }] : [],
      selected: 0,
      page: user ? 'found' : 'notfound',
    });
  }

  /** Starts pairing with the selected headset. Saved access skips the approval prompt. */
  pair() {
    return this.guarded(() => this.pairSteps());
  }

  /** Sends one registration request, unless the saved key already works. Only a user action calls this. */
  register() {
    return this.guarded(() => this.registerSteps());
  }

  runSetup() {
    return this.guarded(() => this.setupSteps());
  }

  /** Ends a step that failed unexpectedly, such as a settings write, on its page with Cancel available. */
  private async guarded(step: () => Promise<void>) {
    try {
      await step();
    } catch (e) {
      error(`[SteamFramePairing] A pairing step failed: ${e}`);
      if (this.stopForCancel()) return;
      this.patchFlow({ busy: false, error: 'persistence' });
    }
  }

  private async pairSteps() {
    const flow = this._flow();
    const candidate = flow?.candidates[flow.selected];
    if (!flow || !candidate) return;
    this.patchFlow({ page: 'request', error: undefined, busy: true });
    const user = await invoke<string | null>('steam_frame_get_ssh_user', {
      address: candidate.address,
    });
    if (this.stopForCancel()) return;
    if (!user) return this.patchFlow({ page: 'notfound', busy: false });
    const pairing = await this.preparePairing(flow, candidate.address, user);
    if (this.stopForCancel() || !pairing) return;
    await this.register();
  }

  private async registerSteps() {
    const pairing = this.flowPairing();
    if (!pairing) return;
    this.patchFlow({ page: 'request', error: undefined, busy: true });
    const probe = await this.probe(pairing);
    if (this.stopForCancel()) return;
    if (probe.status === 'ok') return this.approved(probe.hostKeyPin);
    if (probe.status === 'hostKeyChanged')
      return this.patchFlow({ page: 'hostKeyChanged', busy: false });
    this.patchFlow({ page: 'awaiting' });
    const mayBeApproved = !!pairing.mayBeApproved;
    try {
      await this.updatePairing(pairing.deviceId, { mayBeApproved: true });
    } catch (e) {
      error(`[SteamFramePairing] Could not save the attempt before the request: ${e}`);
      if (this.stopForCancel()) return;
      return this.patchFlow({ page: 'found', busy: false, error: 'persistence' });
    }
    if (this.stopForCancel()) return;
    const outcome = await invoke<SteamFrameRegisterOutcome>('steam_frame_request_approval', {
      address: pairing.address,
      publicKey: pairing.publicKey,
    });
    info(`[SteamFramePairing] Registration: ${outcome}`);
    if (outcome === 'registered' || outcome === 'lost' || outcome === 'failed') {
      if (this.cancelRequested) return this.finishCancel();
      return this.confirmAccess();
    }
    await this.updatePairing(pairing.deviceId, { mayBeApproved });
    if (this.stopForCancel()) return;
    const pages: Partial<Record<SteamFrameRegisterOutcome, SteamFramePage>> = {
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
  private async probeUntilReady(pairing: SteamFramePairing): Promise<SteamFrameProbeOutcome> {
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

  private async setupSteps() {
    const pairing = this.flowPairing();
    const flow = this._flow();
    if (!pairing?.hostKeyPin || !flow) return;
    this.setupAttemptId = uuidv4();
    this.patchFlow({ page: 'setup', stage: 'verify', error: undefined, busy: true });
    const result = await invoke<SteamFrameSetupResult>('steam_frame_set_up_helper', {
      request: {
        attemptId: this.setupAttemptId,
        access: this.accessOf(pairing),
        pcId: pairing.id,
        token: pairing.token,
        publicKey: pairing.publicKey,
        identity: flow.identity,
      },
    });
    info(`[SteamFramePairing] Setup: ${result.status}`);
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
        this.cancelRequested = false;
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
    const pairing = this.flowPairing();
    if (!pairing || pairing.complete) return this.endFlow();
    this.patchFlow({ page: 'cancelling', error: undefined, busy: true });
    let removed = false;
    try {
      removed = await this.removeAttempt(pairing);
    } catch (e) {
      error(`[SteamFramePairing] Could not finish cancelling: ${e}`);
    }
    if (removed) this.endFlow();
    else this.patchFlow({ page: 'cleanupFailed', busy: false });
  }

  /** Returns false while the headset may still hold this PC's access. */
  private async removeAttempt(pairing: SteamFramePairing): Promise<boolean> {
    if (!pairing.hostKeyPin && pairing.mayBeApproved) {
      const probe = await this.probeUntilReady(pairing);
      if (probe.status === 'ok') {
        pairing = (await this.updatePairing(pairing.deviceId, { hostKeyPin: probe.hostKeyPin }))!;
      } else if (probe.status !== 'rejected') {
        return false;
      }
    }
    if (pairing.hostKeyPin) {
      const outcome = await this.cleanup(pairing, !!pairing.helperInstalledByPairing);
      if (outcome.status !== 'done') return false;
    }
    await this.removePairing(pairing.deviceId);
    return true;
  }

  /** Forgets a cancelled attempt on this PC after cleanup failed. */
  async leaveCleanup() {
    const pairing = this.flowPairing();
    try {
      if (pairing && !pairing.complete) await this.removePairing(pairing.deviceId);
    } finally {
      this.endFlow();
    }
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

  private setPairings(pairings: SteamFramePairing[]) {
    this._pairings.set(pairings);
    this.pairings$.next(pairings);
  }

  private patchFlow(patch: Partial<SteamFrameFlow>) {
    const flow = this._flow();
    if (flow) this._flow.set({ ...flow, ...patch });
  }

  private accessOf(pairing: SteamFramePairing) {
    return {
      address: pairing.address,
      user: pairing.user,
      privateKey: pairing.privateKey,
      hostKeyPin: pairing.hostKeyPin ?? null,
    };
  }

  private probe(pairing: SteamFramePairing) {
    return invoke<SteamFrameProbeOutcome>('steam_frame_check_ssh_access', {
      access: this.accessOf(pairing),
    });
  }

  private cleanup(pairing: SteamFramePairing, removeHelper: boolean) {
    return invoke<SteamFrameCleanupOutcome>('steam_frame_remove_access', {
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
    flow: SteamFrameFlow,
    address: string,
    user: string
  ): Promise<SteamFramePairing | undefined> {
    const existing = this.pairingFor(flow.deviceId);
    if (existing && !existing.complete) {
      return this.updatePairing(flow.deviceId, { address, user });
    }
    let credentials: { privateKey: string; publicKey: string; token: string };
    try {
      credentials = await invoke('steam_frame_create_pairing_keys');
    } catch (e) {
      error(`[SteamFramePairing] Could not create the pairing key: ${e}`);
      this.patchFlow({ page: 'found', busy: false, error: 'keys' });
      return undefined;
    }
    const pairing: SteamFramePairing = {
      id: uuidv4(),
      deviceId: flow.deviceId,
      identity: flow.identity,
      address,
      user,
      ...credentials,
      complete: false,
    };
    const previous = this._pairings();
    this.setPairings([...previous.filter((p) => p.deviceId !== flow.deviceId), pairing]);
    try {
      await this.save();
    } catch (e) {
      error(`[SteamFramePairing] Could not save the pairing key: ${e}`);
      this.setPairings(previous);
      this.patchFlow({ page: 'found', busy: false, error: 'persistence' });
      return undefined;
    }
    await this.pushPairings();
    return pairing;
  }

  private async updatePairing(deviceId: string, patch: Partial<SteamFramePairing>) {
    let updated: SteamFramePairing | undefined;
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

  private onConnectionState(state: SteamFrameConnectionState) {
    this._connections.set({ ...this._connections(), [state.pairingId]: state });
    const pairing = this._pairings().find((p) => p.id === state.pairingId);
    if (!pairing) return;
    const patch: Partial<SteamFramePairing> = {};
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
    await invoke('steam_frame_sync_connections', { pairings });
  }

  private async load() {
    const data = await SETTINGS_STORE.get<SteamFramePairingData>(SETTINGS_KEY_STEAM_FRAME_PAIRING);
    const pairings: SteamFramePairing[] = [];
    for (const stored of data?.pairings ?? []) {
      const privateKey = await unprotectSecret(stored.privateKey);
      const token = await unprotectSecret(stored.token);
      if (!privateKey || !token) {
        error(`[SteamFramePairing] Skipped pairing ${stored.id}: its secrets cannot be read`);
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
    await SETTINGS_STORE.set(SETTINGS_KEY_STEAM_FRAME_PAIRING, {
      version: 1,
      pairings,
    } satisfies SteamFramePairingData);
    await SETTINGS_STORE.save();
  }
}

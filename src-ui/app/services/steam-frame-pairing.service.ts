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

type SetupStageEvent = { attemptId: string; stage: SteamFrameSetupStage | 'installed' };

/** Owns Steam Frame pairing records and runs the pairing wizard's steps. */
@Injectable({
  providedIn: 'root',
})
export class SteamFramePairingService {
  private readonly supportedModels = signal<{ manufacturer: string; model: string }[]>([]);
  private readonly _pairings = signal<SteamFramePairing[]>([]);
  private readonly _connections = signal<Record<string, SteamFrameConnectionState>>({});
  private readonly _flow = signal<SteamFrameFlow | null>(null);
  private readonly _reinstalls = signal<Record<string, 'running' | 'failed'>>({});
  /** Set when Cancel arrives during a step; that step finishes the cancel when it returns. */
  private cancelRequested = false;
  /** Bumped by every search and page change, so a result from an older search is dropped. */
  private search = 0;
  /** The running setup; stage events from any other attempt are ignored. */
  private setupAttemptId?: string;

  readonly pairings$ = new BehaviorSubject<SteamFramePairing[]>([]);
  readonly connections = this._connections.asReadonly();
  readonly flow = this._flow.asReadonly();
  /**
   * Reinstalls started from Device Manager, by pairing id. `failed` stays while the helper is
   * missing or offline.
   */
  readonly reinstalls = this._reinstalls.asReadonly();
  readonly flowPairing = computed(() => {
    const flow = this._flow();
    return flow ? this.pairingFor(flow.deviceId) : undefined;
  });

  constructor(
    private modalService: ModalService,
    private deviceManager: DeviceManagerService
  ) {}

  /** Loads saved pairings, subscribes to core events, and starts their connections. */
  async init() {
    this.supportedModels.set(await invoke('steam_frame_get_supported_models'));
    await this.load();

    // follow connection states and the running setup's stages
    await listen<SteamFrameConnectionState>('STEAM_FRAME_CONNECTION_STATE', (event) =>
      this.onConnectionState(event.payload)
    );
    await listen<SetupStageEvent>('STEAM_FRAME_SETUP_STAGE', (event) =>
      this.onSetupStage(event.payload)
    );

    // catch up on states sent before we listened
    for (const state of await invoke<SteamFrameConnectionState[]>(
      'steam_frame_get_connection_states'
    )) {
      this.onConnectionState(state);
    }

    // start connections for the saved pairings
    await this.pushPairings();
  }

  /** Shows the running setup's stage, and records when it installed the helper. */
  private onSetupStage({ attemptId, stage }: SetupStageEvent) {
    if (attemptId !== this.setupAttemptId) return;
    if (stage !== 'installed') return this.patchFlow({ stage });
    const deviceId = this._flow()?.deviceId;
    if (deviceId) void this.markHelperInstalled(deviceId);
  }

  isSupported(manufacturer?: string, model?: string): boolean {
    return this.supportedModels().some((m) => m.manufacturer === manufacturer && m.model === model);
  }

  /** The pairing identity of a supported headset, or null for any other device. */
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

    // start a fresh flow unless a step still runs
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

    // open the modal once; closing drops an idle flow
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

  /** Moves to another page, abandoning a running search. */
  go(page: SteamFramePage) {
    this.search++;
    this.patchFlow({ page, error: undefined, busy: false });
  }

  select(index: number) {
    this.patchFlow({ selected: index });
  }

  /** Searches the network for headsets. */
  discover() {
    return this.guarded(() => this.discoverSteps(), { page: 'notfound' });
  }

  /** Checks one typed address for a devkit service. */
  connectManual(address: string) {
    return this.guarded(() => this.connectManualSteps(address), { page: 'notfound' });
  }

  private async discoverSteps() {
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

  private async connectManualSteps(address: string) {
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

  /** Installs or reuses the helper and completes the pairing. */
  runSetup() {
    return this.guarded(() => this.setupSteps());
  }

  /** Ends a step that failed unexpectedly, such as a settings write, on its page with Cancel available. */
  private async guarded(
    step: () => Promise<void>,
    failure: Partial<SteamFrameFlow> = { error: 'persistence' }
  ) {
    try {
      await step();
    } catch (e) {
      error(`[SteamFramePairing] A pairing step failed: ${e}`);
      if (this.stopForCancel()) return;
      this.patchFlow({ ...failure, busy: false });
    }
  }

  private async pairSteps() {
    const flow = this._flow();
    const candidate = flow?.candidates[flow.selected];
    if (!flow || !candidate) return;

    // make sure the devkit service still answers
    this.patchFlow({ page: 'request', error: undefined, busy: true });
    const user = await invoke<string | null>('steam_frame_get_ssh_user', {
      address: candidate.address,
    });
    if (this.stopForCancel()) return;
    if (!user) return this.patchFlow({ page: 'notfound', busy: false });

    // save the attempt, then ask for approval
    const pairing = await this.preparePairing(flow, candidate.address, user);
    if (this.stopForCancel() || !pairing) return;
    await this.register();
  }

  private async registerSteps() {
    const pairing = this.flowPairing();
    if (!pairing) return;

    // skip the prompt when this PC's key already works
    this.patchFlow({ page: 'request', error: undefined, busy: true });
    const probe = await this.probe(pairing);
    if (this.stopForCancel()) return;
    if (probe.status === 'ok') return this.approved(probe.hostKeyPin);
    if (probe.status === 'hostKeyChanged')
      return this.patchFlow({ page: 'hostKeyChanged', busy: false });

    // record that the headset may approve, before asking
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

    // ask the user on the headset and wait
    const outcome = await invoke<SteamFrameRegisterOutcome>('steam_frame_request_approval', {
      address: pairing.address,
      publicKey: pairing.publicKey,
    });
    info(`[SteamFramePairing] Registration: ${outcome}`);

    // approved or unclear: check whether access works
    if (outcome === 'registered' || outcome === 'lost' || outcome === 'failed') {
      if (this.cancelRequested) return this.finishCancel();
      return this.confirmAccess();
    }

    // a clear no: restore the flag and show why
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

    // access works: continue, or pin it for Cancel
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

  /** Pins the host key the first login saw, then runs setup. */
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

    // run setup; stage events update the page
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

    // remember an install, so Cancel removes that helper
    if (result.installed) {
      await this.markHelperInstalled(pairing.deviceId);
    }
    if (this.cancelRequested) return this.finishCancel();

    // show the page for the outcome
    switch (result.status) {
      // save the finished pairing and start its connection
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

      // another headset answered: undo our access there
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
          error:
            {
              identityMissing: 'identityMissing',
              helperBusy: 'helperBusy',
              unreachable: 'offline',
            }[result.status as string] ?? 'setupFailed',
        });
    }
  }

  /** Starts a helper update. Progress and the result arrive as connection states. */
  async updateHelper(pairing: SteamFramePairing) {
    await invoke('steam_frame_update_helper', { pairingId: pairing.id });
  }

  /** Installs the helper again after it went missing, and pins its new certificate. */
  async reinstallHelper(pairing: SteamFramePairing) {
    if (this._reinstalls()[pairing.id] === 'running') return;

    this.setReinstall(pairing.id, 'running');
    try {
      // run setup as a fresh install that removes itself when it fails
      const result = await invoke<SteamFrameSetupResult>('steam_frame_set_up_helper', {
        request: {
          attemptId: uuidv4(),
          access: this.accessOf(pairing),
          pcId: pairing.id,
          token: pairing.token,
          publicKey: pairing.publicKey,
          identity: pairing.identity,
          removeOnFailure: true,
        },
      });
      info(`[SteamFramePairing] Reinstall: ${result.status}`);
      if (result.status !== 'complete') return this.setReinstall(pairing.id, 'failed');

      // pin the new certificate and reconnect with it
      await this.updatePairing(pairing.deviceId, {
        certPin: result.certPin,
        port: result.port,
        helperVersion: result.helperVersion,
        lastSeen: Date.now(),
      });
      await this.pushPairings();
      this.setReinstall(pairing.id, undefined);
    } catch (e) {
      error(`[SteamFramePairing] Reinstall failed: ${e}`);
      this.setReinstall(pairing.id, 'failed');
    }
  }

  private setReinstall(pairingId: string, state?: 'running' | 'failed') {
    const { [pairingId]: _, ...others } = this._reinstalls();
    this._reinstalls.set(state ? { ...others, [pairingId]: state } : others);
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

    // nothing to undo for a finished pairing
    if (!pairing || pairing.complete) return this.endFlow();

    // undo the attempt, or offer a way out
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
    // an unpinned attempt may still have been approved
    if (!pairing.hostKeyPin && pairing.mayBeApproved) {
      const probe = await this.probeUntilReady(pairing);
      if (probe.status === 'ok') {
        pairing = (await this.updatePairing(pairing.deviceId, { hostKeyPin: probe.hostKeyPin }))!;
      } else if (probe.status !== 'rejected') {
        return false;
      }
    }

    // remove our key, token, and any helper we installed
    if (pairing.hostKeyPin) {
      const outcome = await this.cleanup(pairing, !!pairing.helperInstalledByPairing);
      if (outcome.status !== 'done') return false;
    }

    // headset is clean; a failed local delete is harmless
    try {
      await this.removePairing(pairing.deviceId);
    } catch (e) {
      error(`[SteamFramePairing] Could not delete the cancelled attempt on this PC: ${e}`);
    }
    return true;
  }

  /** Forgets a cancelled attempt on this PC after cleanup failed. */
  async leaveCleanup() {
    const pairing = this.flowPairing();
    try {
      if (pairing && !pairing.complete) await this.removePairing(pairing.deviceId);
    } catch (e) {
      error(`[SteamFramePairing] Could not delete the cancelled attempt on this PC: ${e}`);
    }
    this.endFlow();
  }

  /** Drops the flow and closes the wizard. */
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

  /** The SSH access the core commands need for a pairing. */
  private accessOf(pairing: SteamFramePairing) {
    return {
      address: pairing.address,
      user: pairing.user,
      privateKey: pairing.privateKey,
      hostKeyPin: pairing.hostKeyPin ?? null,
    };
  }

  /** Tries this PC's key on the headset once. */
  private probe(pairing: SteamFramePairing) {
    return invoke<SteamFrameProbeOutcome>('steam_frame_check_ssh_access', {
      access: this.accessOf(pairing),
    });
  }

  /** Removes this PC's access from the headset, and the helper when asked. */
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
    // an unfinished attempt keeps its key
    const existing = this.pairingFor(flow.deviceId);
    if (existing && !existing.complete) {
      return this.updatePairing(flow.deviceId, { address, user });
    }

    // create a new key and token
    let credentials: { privateKey: string; publicKey: string; token: string };
    try {
      credentials = await invoke('steam_frame_create_pairing_keys');
    } catch (e) {
      error(`[SteamFramePairing] Could not create the pairing key: ${e}`);
      this.patchFlow({ page: 'found', busy: false, error: 'keys' });
      return undefined;
    }

    // replace any older pairing for this headset, and save
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

    // the old pairing's connection stops
    await this.pushPairings();
    return pairing;
  }

  /** Keeps the marker in memory even when the save fails, so Cancel still removes that helper. */
  private async markHelperInstalled(deviceId: string) {
    this.setPairings(
      this._pairings().map((p) =>
        p.deviceId === deviceId ? { ...p, helperInstalledByPairing: true } : p
      )
    );
    try {
      await this.save();
    } catch (e) {
      error(`[SteamFramePairing] Could not save that this attempt installed the helper: ${e}`);
    }
  }

  /** Applies the change only if it reaches the disk; a failed save restores the previous pairings. */
  private async updatePairing(deviceId: string, patch: Partial<SteamFramePairing>) {
    const previous = this._pairings();
    let updated: SteamFramePairing | undefined;
    this.setPairings(
      previous.map((p) => (p.deviceId === deviceId ? (updated = { ...p, ...patch }) : p))
    );
    try {
      await this.save();
    } catch (e) {
      this.setPairings(previous);
      throw e;
    }
    return updated;
  }

  /** Deletes the pairing, saves, and stops its connection. */
  private async removePairing(deviceId: string) {
    this.setPairings(this._pairings().filter((p) => p.deviceId !== deviceId));
    await this.save();
    await this.pushPairings();
  }

  /** Shows a connection state, and saves what the core learned about the headset. */
  private onConnectionState(state: SteamFrameConnectionState) {
    this._connections.set({ ...this._connections(), [state.pairingId]: state });
    // a failed reinstall stops mattering once the helper is back
    const reinstall = this._reinstalls()[state.pairingId];
    if (reinstall === 'failed' && !['helperMissing', 'offline'].includes(state.status)) {
      this.setReinstall(state.pairingId, undefined);
    }

    // save newer contact, version, address, or certificate
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

  /** Sends the complete pairings to the core, which keeps one connection per pairing. */
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

  /** Reads saved pairings, skipping any whose secrets cannot be decrypted. */
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

  /** The last queued save; the next save starts after it settles. */
  private saving: Promise<void> = Promise.resolve();

  /** Writes one save at a time, each from the pairings as they are when it starts. */
  private save(): Promise<void> {
    const next = this.saving.catch(() => undefined).then(() => this.write());
    this.saving = next;
    return next;
  }

  /** Encrypts the secrets and writes the pairings to the settings file. */
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

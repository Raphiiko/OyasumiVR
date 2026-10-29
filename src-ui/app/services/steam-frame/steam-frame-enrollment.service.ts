import { Injectable, computed, signal } from '@angular/core';
import { error, info } from '@tauri-apps/plugin-log';
import { v4 as uuidv4 } from 'uuid';
import { DMKnownDevice } from '../../models/device-manager';
import {
  SteamFrameFlow,
  SteamFramePage,
  SteamFramePairing,
  SteamFrameUnpairFailure,
} from '../../models/steam-frame';
import {
  CleanupMode,
  commands,
  events,
  PairingKeys,
  ProbeOutcome,
  RegisterOutcome,
  SteamFrameSetupStageEvent,
} from '../../bindings';
import { ModalService } from '../modal.service';
import { DeviceManagerService } from '../device-manager.service';
import { SteamFrameService } from './steam-frame.service';

/**
 * Enrolls a Steam Frame through the pairing wizard, and unenrolls it. Enrolling ends in a pairing,
 * which `SteamFrameService` keeps.
 */
@Injectable({
  providedIn: 'root',
})
export class SteamFrameEnrollmentService {
  private readonly _flow = signal<SteamFrameFlow | null>(null);
  /** Set when Cancel arrives during a step; that step finishes the cancel when it returns. */
  private cancelRequested = false;
  /** Bumped by every search and page change, so a result from an older search is dropped. */
  private search = 0;
  /** The running setup; stage events from any other attempt are ignored. */
  private setupAttemptId?: string;
  /** Set from the first open request until the wizard closes, across the modal's late registration. */
  private wizardOpen = false;

  readonly flow = this._flow.asReadonly();
  readonly flowPairing = computed(() => {
    const flow = this._flow();
    return flow ? this.steamFrame.pairingFor(flow.deviceId) : undefined;
  });

  constructor(
    private modalService: ModalService,
    private deviceManager: DeviceManagerService,
    private steamFrame: SteamFrameService
  ) {}

  /** Follows the running setup's stages. */
  async init() {
    await events.steamFrameSetupStageEvent.listen((event) => this.onSetupStage(event.payload));
  }

  /** Shows the running setup's stage. */
  private onSetupStage({ attemptId, stage }: SteamFrameSetupStageEvent) {
    if (attemptId !== this.setupAttemptId) return;
    this.patchFlow({ stage });
  }

  /** Opens the wizard for the headset SteamVR is using now. Any other headset is ignored. */
  async openWizard(device: DMKnownDevice) {
    const identity = this.steamFrame.identityOf(device);
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
    if (this.wizardOpen) return;
    this.wizardOpen = true;
    try {
      const { SteamFramePairingModalComponent } =
        await import('../../components/steam-frame/steam-frame-pairing-modal/steam-frame-pairing-modal.component');
      this.modalService
        .addModal(SteamFramePairingModalComponent, undefined, {
          id: 'steam-frame-pairing',
          wrapperDefaultClass: 'modal-wrapper-steam-frame-pairing',
          closeOnEscape: false,
        })
        .subscribe(() => {
          this.wizardOpen = false;
          if (!this._flow()?.busy) this._flow.set(null);
        });
    } catch (e) {
      this.wizardOpen = false;
      throw e;
    }
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
    const candidates = await commands.steamFrameDiscoverHeadsets();
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
    const user = await commands.steamFrameGetSshUser(address);
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
    const user = await commands.steamFrameGetSshUser(candidate.address);
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
    if (probe.status === 'hostKeyChanged') {
      error('[SteamFramePairing] Access check: hostKeyChanged');
      return this.patchFlow({ page: 'setupFailed', busy: false, error: 'setupFailed' });
    }

    // record that the headset may approve, before asking
    this.patchFlow({ page: 'awaiting' });
    const mayBeApproved = !!pairing.mayBeApproved;
    try {
      await this.steamFrame.updatePairing(pairing.deviceId, { mayBeApproved: true });
    } catch (e) {
      error(`[SteamFramePairing] Could not save the attempt before the request: ${e}`);
      if (this.stopForCancel()) return;
      return this.patchFlow({ page: 'found', busy: false, error: 'persistence' });
    }
    if (this.stopForCancel()) return;

    // ask the user on the headset and wait
    const outcome = await commands.steamFrameRequestApproval(pairing.address, pairing.publicKey);
    info(`[SteamFramePairing] Registration: ${outcome}`);

    // approved or unclear: check whether access works
    if (outcome === 'registered' || outcome === 'lost' || outcome === 'failed') {
      if (this.cancelRequested) return this.finishCancel();
      return this.confirmAccess();
    }

    // a clear no: restore the flag and show why
    await this.steamFrame.updatePairing(pairing.deviceId, { mayBeApproved });
    if (this.stopForCancel()) return;
    const pages: Partial<Record<RegisterOutcome, SteamFramePage>> = {
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
        await this.steamFrame.updatePairing(pairing.deviceId, { hostKeyPin: probe.hostKeyPin });
        return this.finishCancel();
      }
      return this.approved(probe.hostKeyPin);
    }
    if (this.stopForCancel()) return;
    if (probe.status === 'hostKeyChanged') {
      error('[SteamFramePairing] Access check: hostKeyChanged');
      return this.patchFlow({ page: 'setupFailed', busy: false, error: 'setupFailed' });
    }
    this.patchFlow({ page: 'uncertain', busy: false });
  }

  /** Probes a few times, because sshd may still be starting right after an approval. */
  private async probeUntilReady(pairing: SteamFramePairing): Promise<ProbeOutcome> {
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
    await this.steamFrame.updatePairing(pairing.deviceId, { hostKeyPin });
    await this.runSetup();
  }

  private async setupSteps() {
    const pairing = this.flowPairing();
    const flow = this._flow();
    if (!pairing || !flow) return;
    // a failed access check lands on the setup page too, so Retry checks access again
    if (!pairing.hostKeyPin) return this.registerSteps();

    // run setup; stage events update the page
    this.setupAttemptId = uuidv4();
    this.patchFlow({ page: 'setup', stage: 'verify', error: undefined, busy: true });
    const result = await this.steamFrame.setUpHelper(pairing, flow.identity, this.setupAttemptId);
    info(`[SteamFramePairing] Setup: ${result.status}`);
    if (this.cancelRequested) return this.finishCancel();

    // show the page for the outcome
    switch (result.status) {
      // save the finished pairing and start its connection
      case 'complete':
        await this.steamFrame.updatePairing(pairing.deviceId, {
          complete: true,
          certPin: result.certPin,
          port: result.port,
          helperVersion: result.helperVersion,
        });
        await this.steamFrame.pushPairings();
        this.cancelRequested = false;
        return this.patchFlow({ page: 'success', busy: false });

      // another headset answered: undo our access there
      case 'wrongDevice': {
        this.patchFlow({ page: 'wrongDevice' });
        const outcome = await this.cleanup(pairing, 'unused');
        await this.steamFrame.removePairing(pairing.deviceId);
        this.cancelRequested = false;
        return this.patchFlow({
          page: 'wrongDevice',
          busy: false,
          error: ['done', 'rejected'].includes(outcome.status)
            ? undefined
            : 'wrongDeviceAccessLeft',
        });
      }
      case 'needsAppUpdate':
        return this.patchFlow({ page: 'needsUpdate', busy: false });
      case 'hostKeyChanged':
      case 'rejected':
        error(`[SteamFramePairing] Setup: ${result.status}`);
        return this.patchFlow({ page: 'setupFailed', busy: false, error: 'setupFailed' });
      default:
        return this.patchFlow({
          page: 'setupFailed',
          busy: false,
          error:
            { identityMissing: 'identityMissing', unreachable: 'offline' }[
              result.status as string
            ] ?? 'setupFailed',
        });
    }
  }

  /** Counts the other PCs using this headset's helper, or says why the headset can't be asked. */
  async otherPcCount(pairing: SteamFramePairing): Promise<number | SteamFrameUnpairFailure> {
    const outcome = await commands.steamFrameCountOtherPcs(
      this.steamFrame.accessOf(pairing),
      pairing.id
    );
    return outcome.status === 'ok' ? outcome.count : outcome.status;
  }

  /**
   * Removes this PC's access from the headset, then the local pairing. The helper goes too when
   * `uninstall`, or when no other PC uses it. Returns why the headset cleanup failed, or null.
   */
  async unenroll(
    pairing: SteamFramePairing,
    uninstall: boolean
  ): Promise<SteamFrameUnpairFailure | null> {
    const outcome = await this.cleanup(pairing, uninstall ? 'uninstall' : 'unused');
    info(`[SteamFramePairing] Unenroll: ${outcome.status}`);
    if (outcome.status !== 'done') return outcome.status;
    try {
      await this.steamFrame.removePairing(pairing.deviceId);
    } catch (e) {
      error(`[SteamFramePairing] Could not save the unpaired state: ${e}`);
      return 'failed';
    }
    return null;
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
        pairing = (await this.steamFrame.updatePairing(pairing.deviceId, {
          hostKeyPin: probe.hostKeyPin,
        }))!;
      } else if (probe.status !== 'rejected') {
        return false;
      }
    }

    // remove our key and token, and the helper when no other PC uses it
    if (pairing.hostKeyPin) {
      const outcome = await this.cleanup(pairing, 'unused');
      if (!['done', 'rejected'].includes(outcome.status)) return false;
    }

    // headset is clean; a failed local delete is harmless
    try {
      await this.steamFrame.removePairing(pairing.deviceId);
    } catch (e) {
      error(`[SteamFramePairing] Could not delete the cancelled attempt on this PC: ${e}`);
    }
    return true;
  }

  /** Forgets a cancelled attempt on this PC after cleanup failed. */
  async leaveCleanup() {
    const pairing = this.flowPairing();
    try {
      if (pairing && !pairing.complete) await this.steamFrame.removePairing(pairing.deviceId);
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

  private patchFlow(patch: Partial<SteamFrameFlow>) {
    const flow = this._flow();
    if (flow) this._flow.set({ ...flow, ...patch });
  }

  /** Tries this PC's key on the headset once. */
  private probe(pairing: SteamFramePairing) {
    return commands.steamFrameCheckSshAccess(this.steamFrame.accessOf(pairing));
  }

  /** Removes this PC's access from the headset, and the helper as `mode` asks. */
  private cleanup(pairing: SteamFramePairing, mode: CleanupMode) {
    return commands.steamFrameRemoveAccess({
      access: this.steamFrame.accessOf(pairing),
      pcId: pairing.id,
      publicKey: pairing.publicKey,
      mode,
    });
  }

  /**
   * Returns the attempt for this headset, saved before any registration. An unfinished attempt
   * keeps its key; a completed pairing is replaced by a new one with the same id.
   */
  private async preparePairing(
    flow: SteamFrameFlow,
    address: string,
    user: string
  ): Promise<SteamFramePairing | undefined> {
    // an unfinished attempt keeps its key
    const existing = this.steamFrame.pairingFor(flow.deviceId);
    if (existing && !existing.complete) {
      return this.steamFrame.updatePairing(flow.deviceId, { address, user });
    }

    // create a new key and token
    let credentials: PairingKeys;
    try {
      credentials = await commands.steamFrameCreatePairingKeys();
    } catch (e) {
      error(`[SteamFramePairing] Could not create the pairing key: ${e}`);
      this.patchFlow({ page: 'found', busy: false, error: 'keys' });
      return undefined;
    }

    // replace any older pairing for this headset, and save
    const pairing: SteamFramePairing = {
      // provisioning then overwrites the replaced pairing's client record on the headset
      id: existing?.id ?? uuidv4(),
      deviceId: flow.deviceId,
      identity: flow.identity,
      address,
      user,
      ...credentials,
      complete: false,
    };
    try {
      await this.steamFrame.addPairing(pairing);
    } catch (e) {
      error(`[SteamFramePairing] Could not save the pairing key: ${e}`);
      this.patchFlow({ page: 'found', busy: false, error: 'persistence' });
      return undefined;
    }

    // the old pairing's connection stops
    await this.steamFrame.pushPairings();
    return pairing;
  }
}

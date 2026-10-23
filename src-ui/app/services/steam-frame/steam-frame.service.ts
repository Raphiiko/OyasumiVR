import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { error, info } from '@tauri-apps/plugin-log';
import {
  asapScheduler,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  observeOn,
  Subject,
} from 'rxjs';
import { isEqual } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { SETTINGS_KEY_STEAM_FRAME_PAIRING, SETTINGS_STORE } from '../../globals';
import { DMKnownDevice } from '../../models/device-manager';
import { OVRDevice } from '../../models/ovr-device';
import {
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFrameIdentity,
  SteamFramePairing,
  SteamFramePairingData,
  SteamFrameSetupResult,
} from '../../models/steam-frame';
import { protectSecret, unprotectSecret } from '../../utils/secrets';
import { OpenVRService } from '../openvr.service';
import { ToastService } from '../toast.service';

/**
 * Owns the Steam Frame pairing records and their helper connections: helper updates, reinstalls,
 * and controller turn-off. The brightness and color temperature drivers read its state.
 */
@Injectable({
  providedIn: 'root',
})
export class SteamFrameService {
  private readonly supportedModels = signal<{ manufacturer: string; model: string }[]>([]);
  private readonly _pairings = signal<SteamFramePairing[]>([]);
  private readonly _connections = signal<Record<string, SteamFrameConnectionState>>({});
  private readonly _reinstalls = signal<Record<string, 'running'>>({});
  /** Helper-updated notices by pairing id and version, so each shows for one minute per app run. */
  private readonly updatedNotices = new Map<string, 'shown' | 'hidden'>();
  /** Serials of the controllers whose disconnect is on its way to the helper. */
  private readonly controllerTurnOffs = new Set<string>();

  readonly pairings$ = new BehaviorSubject<SteamFramePairing[]>([]);
  readonly connections = this._connections.asReadonly();
  readonly connections$ = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  /** Every fade a helper ended, from this PC or another one. */
  readonly fadeEnded$ = new Subject<SteamFrameFadeEnded>();
  /** Reinstalls started from Device Manager that still run, by pairing id. */
  readonly reinstalls = this._reinstalls.asReadonly();

  constructor(
    private openvr: OpenVRService,
    private toasts: ToastService
  ) {}

  /** Loads saved pairings, subscribes to core events, and starts their connections. */
  async init() {
    this.supportedModels.set(await invoke('steam_frame_get_supported_models'));
    await this.load();

    // follow connection states and fades
    await listen<SteamFrameConnectionState>('STEAM_FRAME_CONNECTION_STATE', (event) =>
      this.onConnectionState(event.payload)
    );
    await listen<SteamFrameFadeEnded>('STEAM_FRAME_FADE_ENDED', (event) =>
      this.fadeEnded$.next(event.payload)
    );

    // catch up on states sent before we listened
    for (const state of await invoke<SteamFrameConnectionState[]>(
      'steam_frame_get_connection_states'
    )) {
      this.onConnectionState(state);
    }

    // start connections for the saved pairings
    await this.pushPairings();

    // show each helper's controllers on the matching OpenVR devices
    combineLatest([this.connections$, this.pairings$, this.openvr.devices.pipe(map(streamingHmds))])
      .pipe(
        map(([states, pairings, hmds]) => frameControllerOverrides(states, pairings, hmds)),
        distinctUntilChanged(isEqual),
        // a synchronous write would publish devices while later subscribers still get the older list
        observeOn(asapScheduler)
      )
      .subscribe((overrides) => this.openvr.setOverrides(overrides));
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

  /** Starts a helper update. Progress and the result arrive as connection states. */
  async updateHelper(pairing: SteamFramePairing) {
    await invoke('steam_frame_update_helper', { pairingId: pairing.id });
  }

  /**
   * Disconnects the controller with this serial on each paired headset whose helper lists it as
   * connected. It stays paired. Resolves false when no headset lists it or one failed.
   */
  async disconnectController(serial: string): Promise<boolean> {
    const pairingIds = new Set(this._pairings().map((p) => p.id));
    const holders = Object.values(this._connections()).filter(
      (state) =>
        state.status === 'connected' &&
        pairingIds.has(state.pairingId) &&
        state.controllers?.some((c) => c.serial === serial && c.connected)
    );
    const results = await Promise.all(
      holders.map((state) => this.disconnectControllerOn(state.pairingId, serial))
    );
    return holders.length > 0 && results.every(Boolean);
  }

  private async disconnectControllerOn(pairingId: string, serial: string): Promise<boolean> {
    try {
      await invoke('steam_frame_disconnect_controller', { pairingId, serial });
      info(`[SteamFrame] Disconnected the headset controller ${serial}`);
      return true;
    } catch (e) {
      error(`[SteamFrame] Could not disconnect the headset controller: ${JSON.stringify(e)}`);
      return false;
    }
  }

  /** Turns off the Frame controllers among these devices, and ignores the rest. */
  async turnOffDevices(ovrDevices: OVRDevice[]): Promise<OVRDevice[]> {
    // look up the current devices, since a caller can hold a copy from before the helper reported
    const serials = new Set(ovrDevices.map((device) => device.serialNumber));
    const controllers = (await firstValueFrom(this.openvr.devices)).filter(
      (device) =>
        device.powerMethod === 'SteamFrame' &&
        device.serialNumber &&
        serials.has(device.serialNumber)
    );
    const results = await Promise.all(controllers.map((device) => this.turnOffController(device)));
    return controllers.filter((_, index) => results[index]);
  }

  /** Turns off one controller for a user action, and shows a toast when it could not be turned off. */
  async turnOffDeviceForUser(ovrDevice: OVRDevice, deviceName: string): Promise<OVRDevice[]> {
    // a press while the first disconnect is on its way is no failure
    if (this.controllerTurnOffs.has(ovrDevice.serialNumber ?? '')) return [];
    const dispatched = await this.turnOffDevices([ovrDevice]);
    if (!dispatched.length) {
      this.toasts.show({
        type: 'error',
        title: { string: 'toasts.devicePower.turnOffFailed.title', values: { name: deviceName } },
        message: 'toasts.devicePower.turnOffFailed.frameHelperFailed',
        duration: 6000,
      });
    }
    return dispatched;
  }

  /** Resolves true when the helper sent the disconnect. The device then stays busy until off. */
  private async turnOffController(device: OVRDevice): Promise<boolean> {
    const serial = device.serialNumber;
    if (
      device.powerMethod !== 'SteamFrame' ||
      !serial ||
      !device.canPowerOff ||
      device.isTurningOff ||
      this.controllerTurnOffs.has(serial)
    )
      return false;
    this.controllerTurnOffs.add(serial);
    info(`[SteamFrame] Turning off device ${device.class}:${serial}`);
    try {
      if (!(await this.disconnectController(serial))) return false;
    } finally {
      this.controllerTurnOffs.delete(serial);
    }
    // busy only once sent: busy clearing on a connected device reads as it powering on
    this.openvr.setTurningOff(device.index, true);
    return true;
  }

  /**
   * Installs the helper again, and pins its new certificate. `repair` replaces any installed
   * helper with the bundled one, a newer one too.
   */
  async reinstallHelper(pairing: SteamFramePairing, repair = false) {
    if (this._reinstalls()[pairing.id]) return;

    this.setReinstall(pairing.id, 'running');
    try {
      // run setup as a fresh install
      const result = await this.setUpHelper(pairing, pairing.identity, uuidv4(), repair);
      info(`[SteamFramePairing] Reinstall: ${result.status}`);
      if (result.status !== 'complete') {
        error(`[SteamFramePairing] Reinstall failed: ${result.status}`);
        return;
      }

      // pin the new certificate and reconnect with it
      await this.updatePairing(pairing.deviceId, {
        certPin: result.certPin,
        port: result.port,
        helperVersion: result.helperVersion,
      });
      await this.pushPairings();
    } catch (e) {
      error(`[SteamFramePairing] Reinstall failed: ${e}`);
    } finally {
      this.setReinstall(pairing.id, undefined);
    }
  }

  private setReinstall(pairingId: string, state?: 'running') {
    const { [pairingId]: _, ...others } = this._reinstalls();
    this._reinstalls.set(state ? { ...others, [pairingId]: state } : others);
  }

  /** Installs or reuses the helper on the headset. `repair` replaces any installed helper. */
  setUpHelper(
    pairing: SteamFramePairing,
    identity: SteamFrameIdentity,
    attemptId: string,
    repair = false
  ) {
    return invoke<SteamFrameSetupResult>('steam_frame_set_up_helper', {
      request: {
        attemptId,
        access: this.accessOf(pairing),
        pcId: pairing.id,
        token: pairing.token,
        publicKey: pairing.publicKey,
        identity,
        repair,
      },
    });
  }

  /** The SSH access the core commands need for a pairing. */
  accessOf(pairing: SteamFramePairing) {
    return {
      address: pairing.address,
      user: pairing.user,
      privateKey: pairing.privateKey,
      hostKeyPin: pairing.hostKeyPin ?? null,
    };
  }

  private setPairings(pairings: SteamFramePairing[]) {
    this._pairings.set(pairings);
    this.pairings$.next(pairings);
  }

  /** Saves the pairing in place of its headset's older one; a failed save restores the pairings. */
  async addPairing(pairing: SteamFramePairing) {
    await this.change((pairings) => [
      ...pairings.filter((p) => p.deviceId !== pairing.deviceId),
      pairing,
    ]);
  }

  /** Applies the change only if it reaches the disk; a failed save restores the previous pairings. */
  async updatePairing(deviceId: string, patch: Partial<SteamFramePairing>) {
    let updated: SteamFramePairing | undefined;
    await this.change((pairings) =>
      pairings.map((p) => (p.deviceId === deviceId ? (updated = { ...p, ...patch }) : p))
    );
    return updated;
  }

  /** Deletes the pairing on this PC, saves, and stops its connection. The headset is untouched. */
  async removePairing(deviceId: string) {
    await this.change((pairings) => pairings.filter((p) => p.deviceId !== deviceId));
    await this.pushPairings();
  }

  /** Shows a connection state, and saves what the core learned about the headset. */
  private onConnectionState(state: SteamFrameConnectionState) {
    state = this.timeUpdatedNotice(state);
    this._connections.set({ ...this._connections(), [state.pairingId]: state });
    this.connections$.next(this._connections());

    // save a newer version, address, or certificate
    const pairing = this._pairings().find((p) => p.id === state.pairingId);
    if (!pairing) return;
    const patch: Partial<SteamFramePairing> = {};
    if (state.helperVersion && state.helperVersion !== pairing.helperVersion)
      patch.helperVersion = state.helperVersion;
    if (state.address !== pairing.address) patch.address = state.address;
    if (state.certPin !== pairing.certPin) patch.certPin = state.certPin;
    if (!Object.keys(patch).length) return;
    this.updatePairing(pairing.deviceId, patch).catch((e) =>
      error(`[SteamFramePairing] Could not save the connection state: ${e}`)
    );
  }

  /** Keeps a helper-updated notice for one minute after it first shows, then drops it. */
  private timeUpdatedNotice(state: SteamFrameConnectionState): SteamFrameConnectionState {
    if (state.maintenance?.kind !== 'updated') return state;
    const key = `${state.pairingId}:${state.maintenance.version}`;
    if (this.updatedNotices.get(key) === 'hidden') return { ...state, maintenance: null };
    if (!this.updatedNotices.has(key)) {
      this.updatedNotices.set(key, 'shown');
      setTimeout(() => {
        this.updatedNotices.set(key, 'hidden');
        const current = this._connections()[state.pairingId];
        if (current) this.onConnectionState(current);
      }, 60_000);
    }
    return state;
  }

  /** Sends the complete pairings to the core, which keeps one connection per pairing. */
  async pushPairings() {
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

  /** The last queued change; the next change starts after it settles. */
  private saving: Promise<void> = Promise.resolve();

  /**
   * Applies and saves one change at a time; a failed save restores the pairings it started from.
   * Queuing the rollback with the change keeps it from undoing a later change.
   */
  private change(apply: (pairings: SteamFramePairing[]) => SteamFramePairing[]): Promise<void> {
    const next = this.saving
      .catch(() => undefined)
      .then(async () => {
        const previous = this._pairings();
        this.setPairings(apply(previous));
        try {
          await this.write();
        } catch (e) {
          this.setPairings(previous);
          throw e;
        }
      });
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

/** The serials of the connected headsets, which stream to this PC's SteamVR. */
function streamingHmds(devices: OVRDevice[]): string[] {
  return devices
    .filter((d) => d.class === 'HMD' && d.isConnected && d.serialNumber)
    .map((d) => d.serialNumber!);
}

/**
 * OpenVR device overrides for the controllers that the helpers of the headsets streaming to this PC
 * report, by serial. A headset that does not stream here is not this PC's to control.
 */
export function frameControllerOverrides(
  states: Record<string, SteamFrameConnectionState>,
  pairings: SteamFramePairing[],
  hmds: string[]
): Record<string, Partial<OVRDevice>> {
  const overrides: Record<string, Partial<OVRDevice>> = {};
  for (const state of Object.values(states)) {
    const pairing = pairings.find((p) => p.id === state.pairingId);
    if (state.status !== 'connected' || !pairing || !hmds.includes(pairing.identity.serial)) {
      continue;
    }
    for (const controller of state.controllers ?? []) {
      overrides[controller.serial] = {
        powerMethod: 'SteamFrame',
        isConnected: controller.connected,
        canPowerOff: controller.connected,
      };
    }
  }
  return overrides;
}

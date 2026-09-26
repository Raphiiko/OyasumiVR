import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SteamFramePairingService } from './steam-frame-pairing.service';
import { DMKnownDevice } from '../models/device-manager';

const { invoke, store } = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('../globals', () => ({ SETTINGS_STORE: store, SETTINGS_KEY_STEAM_FRAME_PAIRING: 'FRAME' }));
vi.mock('./device-manager.service', () => ({ DeviceManagerService: class {} }));
vi.mock('../utils/secrets', () => ({
  protectSecret: async (plain: string) => `protected:${plain}`,
  unprotectSecret: async (stored: string) => stored.replace('protected:', ''),
}));

const device: DMKnownDevice = {
  id: 'OVR_HMD_FPTEST000001',
  typeName: 'Deckard DV2',
  manufacturer: 'Valve',
  defaultName: 'FPTEST000001',
  deviceType: 'HMD',
  lastSeen: 0,
  tagIds: [],
  disabled: false,
};

type Handler = (args: any) => unknown;
let handlers: Record<string, Handler>;
let observed: boolean;
const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);

async function start() {
  const service = new SteamFramePairingService(
    { isModalOpen: () => true, closeModal: vi.fn() } as any,
    { isDeviceObserved: () => observed } as any
  );
  await service.init();
  await service.openWizard(device);
  await service.connectManual('192.168.1.42');
  return service;
}

beforeEach(() => {
  observed = true;
  handlers = {
    steam_frame_get_supported_models: () => [{ manufacturer: 'Valve', model: 'Deckard DV2' }],
    steam_frame_get_connection_states: () => [],
    steam_frame_sync_connections: () => undefined,
    steam_frame_get_ssh_user: () => 'steamos',
    steam_frame_create_pairing_keys: () => ({
      privateKey: 'KEY',
      publicKey: 'ssh-rsa AAA pc',
      token: 'T',
    }),
    steam_frame_check_ssh_access: () => ({ status: 'rejected' }),
    steam_frame_request_approval: () => 'registered',
    steam_frame_set_up_helper: () => ({
      status: 'complete',
      installed: true,
      certPin: 'CERT',
      port: 38440,
      helperVersion: '1.0.0',
    }),
    steam_frame_remove_access: () => ({ status: 'done' }),
  };
  invoke.mockImplementation(async (command: string, args: any) => handlers[command](args));
  store.get.mockResolvedValue(undefined);
  store.set.mockResolvedValue(undefined);
  store.save.mockResolvedValue(undefined);
});

afterEach(() => vi.resetAllMocks());

describe('Steam Frame pairing flow', () => {
  it('skips registration when the saved key already works', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    const service = await start();
    await service.pair();
    expect(calls('steam_frame_request_approval')).toHaveLength(0);
    expect(service.flow()?.page).toBe('success');
    expect(service.pairingFor(device.id)).toMatchObject({ complete: true, hostKeyPin: 'PIN' });
  });

  it('saves the protected key before registering and pins the host key after approval', async () => {
    let probes = 0;
    handlers['steam_frame_check_ssh_access'] = () =>
      probes++ ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    handlers['steam_frame_request_approval'] = () => {
      const saved = store.set.mock.calls.at(-1)?.[1].pairings[0];
      expect(saved).toMatchObject({ privateKey: 'protected:KEY', token: 'protected:T' });
      return 'registered';
    };
    const service = await start();
    await service.pair();
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
    expect(calls('steam_frame_set_up_helper')[0].request).toMatchObject({
      access: { hostKeyPin: 'PIN', privateKey: 'KEY' },
      identity: { serial: 'FPTEST000001', model: 'Deckard DV2', manufacturer: 'Valve' },
    });
  });

  it('never repeats a declined request by itself, and retries with the same key', async () => {
    handlers['steam_frame_request_approval'] = () => 'declined';
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('declined');
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
    await service.register();
    expect(calls('steam_frame_request_approval').map((a) => a.publicKey)).toEqual([
      'ssh-rsa AAA pc',
      'ssh-rsa AAA pc',
    ]);
    expect(calls('steam_frame_create_pairing_keys')).toHaveLength(1);
  });

  it('continues without another prompt when the approval answer was lost', async () => {
    let probes = 0;
    handlers['steam_frame_check_ssh_access'] = () =>
      probes++ ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    handlers['steam_frame_request_approval'] = () => 'lost';
    const service = await start();
    await service.pair();
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
    expect(service.flow()?.page).toBe('success');
  });

  it('tries the saved key before every registration and after a failed answer', async () => {
    const probes: string[] = [];
    let access = false;
    handlers['steam_frame_check_ssh_access'] = () => {
      probes.push('probe');
      return access ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    };
    handlers['steam_frame_request_approval'] = () => 'failed';
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('uncertain');
    expect(probes.length).toBeGreaterThan(1);
    access = true;
    await service.register();
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
    expect(service.flow()?.page).toBe('success');
  }, 15000);

  it('marks the attempt as possibly approved before the request leaves', async () => {
    let answer!: (outcome: string) => void;
    handlers['steam_frame_request_approval'] = () => new Promise((resolve) => (answer = resolve));
    const service = await start();
    const pairing = service.pair();
    await vi.waitFor(() => expect(service.flow()?.page).toBe('awaiting'));
    expect(service.pairingFor(device.id)?.mayBeApproved).toBe(true);
    expect(store.save).toHaveBeenCalled();
    answer('declined');
    await pairing;
    expect(service.pairingFor(device.id)?.mayBeApproved).toBe(false);
  });

  it('ignores a discovery that finishes after a manual address', async () => {
    let finish!: (candidates: unknown[]) => void;
    handlers['steam_frame_discover_headsets'] = () => new Promise((resolve) => (finish = resolve));
    const service = await start();
    const discovery = service.discover();
    await service.connectManual('192.168.1.50');
    finish([]);
    await discovery;
    expect(service.flow()).toMatchObject({
      page: 'found',
      candidates: [{ address: '192.168.1.50' }],
    });
  });

  it('abandons a running discovery when the user switches to manual entry', async () => {
    let finish!: (candidates: unknown[]) => void;
    handlers['steam_frame_discover_headsets'] = () => new Promise((resolve) => (finish = resolve));
    const service = await start();
    const discovery = service.discover();
    service.go('manual');
    finish([]);
    await discovery;
    expect(service.flow()).toMatchObject({ page: 'manual', busy: false });
  });

  it('keeps an unsaved completion out of memory so Cancel still cleans up', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    store.save
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    const service = await start();
    await service.pair();
    expect(service.pairingFor(device.id)?.complete).toBe(false);
    await service.cancel();
    expect(calls('steam_frame_remove_access')).toHaveLength(1);
  });

  it('still removes the helper it installed when that fact could not be saved', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({ status: 'unreachable', installed: true });
    store.save
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    const service = await start();
    await service.pair();
    await service.cancel();
    expect(calls('steam_frame_remove_access')[0].request).toMatchObject({ mode: 'unused' });
  });

  it('closes the wizard when the headset is clean but the local delete fails', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'failed',
      message: 'x',
      installed: false,
    });
    const service = await start();
    await service.pair();
    store.save.mockRejectedValue(new Error('disk full'));
    await service.cancel();
    expect(calls('steam_frame_remove_access')).toHaveLength(1);
    expect(service.flow()).toBeNull();
  });

  it('offers a working retry when the pairing key cannot be created', async () => {
    handlers['steam_frame_create_pairing_keys'] = () => Promise.reject(new Error('no entropy'));
    handlers['steam_frame_request_approval'] = () => 'declined';
    const service = await start();
    await service.pair();
    expect(service.flow()).toMatchObject({ page: 'found', busy: false, error: 'keys' });
    handlers['steam_frame_create_pairing_keys'] = () => ({
      privateKey: 'KEY',
      publicKey: 'ssh-rsa AAA pc',
      token: 'T',
    });
    await service.pair();
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
  });

  it('removes this PC from a different headset and forgets the key', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({ status: 'wrongDevice', installed: false });
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('wrongDevice');
    expect(calls('steam_frame_remove_access')[0].request).toMatchObject({
      mode: 'keep',
      pcId: expect.any(String),
    });
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('shows the different-headset result when cancelled during its cleanup', async () => {
    let finish!: () => void;
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({ status: 'wrongDevice', installed: false });
    handlers['steam_frame_remove_access'] = () =>
      new Promise((resolve) => (finish = () => resolve({ status: 'unreachable' })));
    const service = await start();
    const pairing = service.pair();
    await vi.waitFor(() => expect(calls('steam_frame_remove_access')).toHaveLength(1));
    await service.cancel();
    finish();
    await pairing;
    expect(service.flow()).toMatchObject({
      page: 'wrongDevice',
      busy: false,
      error: 'wrongDeviceAccessLeft',
    });
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('keeps an interrupted setup as a checkpoint that resumes without approval', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({ status: 'unreachable', installed: true });
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('setupFailed');
    expect(service.pairingFor(device.id)).toMatchObject({
      complete: false,
      hostKeyPin: 'PIN',
      helperInstalledByPairing: true,
    });
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'complete',
      installed: false,
      certPin: 'CERT',
      port: 38440,
      helperVersion: '1.0.0',
    });
    await service.runSetup();
    expect(calls('steam_frame_request_approval')).toHaveLength(0);
    expect(service.pairingFor(device.id)?.complete).toBe(true);
  });

  it('removes the approval and the helper this attempt installed when cancelled', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'failed',
      message: 'x',
      installed: true,
    });
    const service = await start();
    await service.pair();
    await service.cancel();
    expect(calls('steam_frame_remove_access')[0].request).toMatchObject({ mode: 'unused' });
    expect(service.pairingFor(device.id)).toBeUndefined();
    expect(service.flow()).toBeNull();
  });

  it('waits for a pending approval before cleaning up a cancelled attempt', async () => {
    let approve!: () => void;
    let probes = 0;
    handlers['steam_frame_check_ssh_access'] = () =>
      probes++ ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    handlers['steam_frame_request_approval'] = () =>
      new Promise((resolve) => (approve = () => resolve('registered')));
    const service = await start();
    const pairing = service.pair();
    await vi.waitFor(() => expect(service.flow()?.page).toBe('awaiting'));
    await service.cancel();
    expect(service.flow()?.page).toBe('cancelling');
    approve();
    await pairing;
    await vi.waitFor(() => expect(calls('steam_frame_remove_access')).toHaveLength(1));
    expect(calls('steam_frame_remove_access')[0].request.access.hostKeyPin).toBe('PIN');
    expect(calls('steam_frame_set_up_helper')).toHaveLength(0);
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('shows the cleanup instructions when an approved attempt is cancelled out of reach', async () => {
    vi.useFakeTimers();
    try {
      handlers['steam_frame_check_ssh_access'] = () => ({ status: 'unreachable' });
      const service = await start();
      const pairing = service.pair();
      await vi.advanceTimersByTimeAsync(20000);
      await pairing;
      expect(service.flow()?.page).toBe('uncertain');
      const cancel = service.cancel();
      await vi.advanceTimersByTimeAsync(20000);
      await cancel;
      expect(service.flow()?.page).toBe('cleanupFailed');
      expect(service.pairingFor(device.id)?.mayBeApproved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets an unclear attempt at once when the headset refuses the key', async () => {
    vi.useFakeTimers();
    try {
      handlers['steam_frame_request_approval'] = () => 'lost';
      const service = await start();
      const pairing = service.pair();
      await vi.advanceTimersByTimeAsync(20000);
      await pairing;
      expect(service.flow()?.page).toBe('uncertain');
      const cancel = service.cancel();
      await vi.advanceTimersByTimeAsync(20000);
      await cancel;
      expect(calls('steam_frame_remove_access')).toHaveLength(0);
      expect(service.pairingFor(device.id)).toBeUndefined();
      expect(service.flow()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers a way out when saving the pin fails during cancel', async () => {
    vi.useFakeTimers();
    try {
      const service = await start();
      const pairing = service.pair();
      await vi.advanceTimersByTimeAsync(20000);
      await pairing;
      expect(service.flow()?.page).toBe('uncertain');
      handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
      store.save.mockRejectedValue(new Error('disk full'));
      const cancel = service.cancel();
      await vi.advanceTimersByTimeAsync(20000);
      await cancel;
      expect(service.flow()).toMatchObject({ page: 'cleanupFailed', busy: false });
      await service.leaveCleanup();
      expect(service.flow()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends no request when the attempt cannot be saved first', async () => {
    const service = await start();
    await service.pair();
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
    store.save.mockRejectedValue(new Error('disk full'));
    await service.register();
    expect(calls('steam_frame_request_approval')).toHaveLength(1);
    expect(service.flow()).toMatchObject({ page: 'found', busy: false, error: 'persistence' });
  }, 15000);

  it('leaves a busy step when a save fails after approval', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    store.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));
    const service = await start();
    await service.pair();
    expect(service.flow()).toMatchObject({ busy: false, error: 'persistence' });
    expect(calls('steam_frame_set_up_helper')).toHaveLength(0);
  });

  it('keeps the attempt when cleanup cannot reach the headset', async () => {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'failed',
      message: 'x',
      installed: false,
    });
    handlers['steam_frame_remove_access'] = () => ({ status: 'unreachable' });
    const service = await start();
    await service.pair();
    await service.cancel();
    expect(service.flow()?.page).toBe('cleanupFailed');
    expect(service.pairingFor(device.id)).toBeDefined();
    await service.leaveCleanup();
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('opens the wizard only for the headset SteamVR is using now', async () => {
    observed = false;
    const service = await start();
    expect(service.flow()).toBeNull();
  });

  it('offers pairing only for allowlisted headsets', async () => {
    const service = new SteamFramePairingService({} as any, {} as any);
    await service.init();
    expect(service.identityOf(device)).not.toBeNull();
    expect(service.identityOf({ ...device, typeName: 'Index' })).toBeNull();
    expect(service.identityOf({ ...device, manufacturer: undefined })).toBeNull();
    expect(service.identityOf({ ...device, id: 'OVR_Controller_X' })).toBeNull();
  });
});

describe('Steam Frame helper maintenance', () => {
  async function paired() {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    const service = await start();
    await service.pair();
    return { service, pairing: service.pairingFor(device.id)! };
  }

  it('starts a helper update for the pairing', async () => {
    handlers['steam_frame_update_helper'] = () => true;
    const { service, pairing } = await paired();
    await service.updateHelper(pairing);
    expect(calls('steam_frame_update_helper')).toEqual([{ pairingId: pairing.id }]);
  });

  it('pins the certificate of a reinstalled helper and reconnects with it', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'complete',
      installed: true,
      certPin: 'NEW',
      port: 38441,
      helperVersion: '1.1.0',
    });
    await service.reinstallHelper(pairing);
    expect(calls('steam_frame_set_up_helper').at(-1).request).toMatchObject({
      pcId: pairing.id,
      removeOnFailure: true,
      identity: pairing.identity,
    });
    expect(service.pairingFor(device.id)).toMatchObject({ certPin: 'NEW', port: 38441 });
    expect(calls('steam_frame_sync_connections').at(-1).pairings[0]).toMatchObject({
      certPin: 'NEW',
      port: 38441,
    });
    expect(service.reinstalls()).toEqual({});
  });

  it('keeps the old pin and reports a failed reinstall', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'failed',
      message: 'x',
      installed: false,
    });
    await service.reinstallHelper(pairing);
    expect(service.pairingFor(device.id)?.certPin).toBe('CERT');
    expect(service.reinstalls()).toEqual({ [pairing.id]: 'failed' });
  });

  it('reports a reinstall as failed when saving the new certificate fails', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'complete',
      installed: true,
      certPin: 'NEW',
      port: 38441,
      helperVersion: '1.1.0',
    });
    store.save.mockRejectedValueOnce(new Error('disk full'));
    await service.reinstallHelper(pairing);
    expect(service.reinstalls()).toEqual({ [pairing.id]: 'failed' });
  });

  it('forgets a failed reinstall once the helper connects again', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({ status: 'unreachable', installed: false });
    await service.reinstallHelper(pairing);
    const state = (status: string) => ({
      pairingId: pairing.id,
      status,
      updateAvailable: false,
      maintenance: null,
      address: pairing.address,
      certPin: 'CERT',
    });
    (service as any).onConnectionState(state('offline'));
    expect(service.reinstalls()).toEqual({ [pairing.id]: 'failed' });
    (service as any).onConnectionState(state('connected'));
    expect(service.reinstalls()).toEqual({});
  });
});

describe('Steam Frame unpairing', () => {
  async function paired() {
    handlers['steam_frame_check_ssh_access'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    const service = await start();
    await service.pair();
    return { service, pairing: service.pairingFor(device.id)! };
  }

  it('deletes the local pairing only after the headset cleanup succeeds', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_remove_access'] = () => ({ status: 'unreachable' });
    expect(await service.unpair(pairing, true)).toBe(false);
    expect(calls('steam_frame_remove_access').at(-1).request).toMatchObject({
      pcId: pairing.id,
      mode: 'uninstall',
    });
    expect(service.pairingFor(device.id)).toBeDefined();
    handlers['steam_frame_remove_access'] = () => ({ status: 'done' });
    expect(await service.unpair(pairing, false)).toBe(true);
    expect(calls('steam_frame_remove_access').at(-1).request.mode).toBe('keep');
    expect(service.pairingFor(device.id)).toBeUndefined();
    expect(calls('steam_frame_sync_connections').at(-1).pairings).toEqual([]);
  });

  it('forgets the pairing without contacting the headset', async () => {
    const { service, pairing } = await paired();
    const cleanups = calls('steam_frame_remove_access').length;
    await service.forget(pairing);
    expect(calls('steam_frame_remove_access')).toHaveLength(cleanups);
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('counts other PCs, and treats a removed pairing as none', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_count_other_pcs'] = () => ({ status: 'ok', count: 2 });
    expect(await service.otherPcCount(pairing)).toBe(2);
    handlers['steam_frame_count_other_pcs'] = () => ({ status: 'rejected' });
    expect(await service.otherPcCount(pairing)).toBe(0);
    handlers['steam_frame_count_other_pcs'] = () => ({ status: 'unreachable' });
    expect(await service.otherPcCount(pairing)).toBeNull();
  });
});

import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FramePairingService } from './frame-pairing.service';
import { DMKnownDevice } from '../models/device-manager';

const { invoke, store } = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('../globals', () => ({ SETTINGS_STORE: store, SETTINGS_KEY_FRAME_PAIRING: 'FRAME' }));
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
  const service = new FramePairingService(
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
    frame_supported_models: () => [{ manufacturer: 'Valve', model: 'Deckard DV2' }],
    frame_connection_states: () => [],
    frame_set_pairings: () => undefined,
    frame_login_name: () => 'steamos',
    frame_create_credentials: () => ({
      privateKey: 'KEY',
      publicKey: 'ssh-rsa AAA pc',
      token: 'T',
    }),
    frame_probe: () => ({ status: 'rejected' }),
    frame_register: () => 'registered',
    frame_setup: () => ({
      status: 'complete',
      installed: true,
      certPin: 'CERT',
      port: 38440,
      helperVersion: '1.0.0',
    }),
    frame_cleanup: () => ({ status: 'done' }),
  };
  invoke.mockImplementation(async (command: string, args: any) => handlers[command](args));
  store.get.mockResolvedValue(undefined);
  store.set.mockResolvedValue(undefined);
});

afterEach(() => vi.resetAllMocks());

describe('Steam Frame pairing flow', () => {
  it('skips registration when the saved key already works', async () => {
    handlers['frame_probe'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    const service = await start();
    await service.pair();
    expect(calls('frame_register')).toHaveLength(0);
    expect(service.flow()?.page).toBe('success');
    expect(service.pairingFor(device.id)).toMatchObject({ complete: true, hostKeyPin: 'PIN' });
  });

  it('saves the protected key before registering and pins the host key after approval', async () => {
    let probes = 0;
    handlers['frame_probe'] = () =>
      probes++ ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    handlers['frame_register'] = () => {
      const saved = store.set.mock.calls.at(-1)?.[1].pairings[0];
      expect(saved).toMatchObject({ privateKey: 'protected:KEY', token: 'protected:T' });
      return 'registered';
    };
    const service = await start();
    await service.pair();
    expect(calls('frame_register')).toHaveLength(1);
    expect(calls('frame_setup')[0].request).toMatchObject({
      access: { hostKeyPin: 'PIN', privateKey: 'KEY' },
      identity: { serial: 'FPTEST000001', model: 'Deckard DV2', manufacturer: 'Valve' },
    });
  });

  it('never repeats a declined request by itself, and retries with the same key', async () => {
    handlers['frame_register'] = () => 'declined';
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('declined');
    expect(calls('frame_register')).toHaveLength(1);
    await service.register();
    expect(calls('frame_register').map((a) => a.publicKey)).toEqual([
      'ssh-rsa AAA pc',
      'ssh-rsa AAA pc',
    ]);
    expect(calls('frame_create_credentials')).toHaveLength(1);
  });

  it('continues without another prompt when the approval answer was lost', async () => {
    let probes = 0;
    handlers['frame_probe'] = () =>
      probes++ ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    handlers['frame_register'] = () => 'lost';
    const service = await start();
    await service.pair();
    expect(calls('frame_register')).toHaveLength(1);
    expect(service.flow()?.page).toBe('success');
  });

  it('tries the saved key before every registration and after a failed answer', async () => {
    const probes: string[] = [];
    let access = false;
    handlers['frame_probe'] = () => {
      probes.push('probe');
      return access ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    };
    handlers['frame_register'] = () => 'failed';
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('uncertain');
    expect(probes.length).toBeGreaterThan(1);
    access = true;
    await service.register();
    expect(calls('frame_register')).toHaveLength(1);
    expect(service.flow()?.page).toBe('success');
  }, 15000);

  it('removes this PC from a different headset and forgets the key', async () => {
    handlers['frame_probe'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['frame_setup'] = () => ({ status: 'wrongDevice', installed: false });
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('wrongDevice');
    expect(calls('frame_cleanup')[0].request).toMatchObject({
      removeHelper: false,
      pcId: expect.any(String),
    });
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('shows the different-headset result when cancelled during its cleanup', async () => {
    let finish!: () => void;
    handlers['frame_probe'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['frame_setup'] = () => ({ status: 'wrongDevice', installed: false });
    handlers['frame_cleanup'] = () =>
      new Promise((resolve) => (finish = () => resolve({ status: 'unreachable' })));
    const service = await start();
    const pairing = service.pair();
    await vi.waitFor(() => expect(calls('frame_cleanup')).toHaveLength(1));
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
    handlers['frame_probe'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['frame_setup'] = () => ({ status: 'unreachable', installed: true });
    const service = await start();
    await service.pair();
    expect(service.flow()?.page).toBe('setupFailed');
    expect(service.pairingFor(device.id)).toMatchObject({
      complete: false,
      hostKeyPin: 'PIN',
      helperInstalledByPairing: true,
    });
    handlers['frame_setup'] = () => ({
      status: 'complete',
      installed: false,
      certPin: 'CERT',
      port: 38440,
      helperVersion: '1.0.0',
    });
    await service.runSetup();
    expect(calls('frame_register')).toHaveLength(0);
    expect(service.pairingFor(device.id)?.complete).toBe(true);
  });

  it('removes the approval and the helper this attempt installed when cancelled', async () => {
    handlers['frame_probe'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['frame_setup'] = () => ({ status: 'failed', message: 'x', installed: true });
    const service = await start();
    await service.pair();
    await service.cancel();
    expect(calls('frame_cleanup')[0].request).toMatchObject({ removeHelper: true });
    expect(service.pairingFor(device.id)).toBeUndefined();
    expect(service.flow()).toBeNull();
  });

  it('waits for a pending approval before cleaning up a cancelled attempt', async () => {
    let approve!: () => void;
    let probes = 0;
    handlers['frame_probe'] = () =>
      probes++ ? { status: 'ok', hostKeyPin: 'PIN' } : { status: 'rejected' };
    handlers['frame_register'] = () =>
      new Promise((resolve) => (approve = () => resolve('registered')));
    const service = await start();
    const pairing = service.pair();
    await vi.waitFor(() => expect(service.flow()?.page).toBe('awaiting'));
    await service.cancel();
    expect(service.flow()?.page).toBe('cancelling');
    approve();
    await pairing;
    await vi.waitFor(() => expect(calls('frame_cleanup')).toHaveLength(1));
    expect(calls('frame_cleanup')[0].request.access.hostKeyPin).toBe('PIN');
    expect(calls('frame_setup')).toHaveLength(0);
    expect(service.pairingFor(device.id)).toBeUndefined();
  });

  it('shows the cleanup instructions when an approved attempt is cancelled out of reach', async () => {
    vi.useFakeTimers();
    try {
      handlers['frame_probe'] = () => ({ status: 'unreachable' });
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
      handlers['frame_register'] = () => 'lost';
      const service = await start();
      const pairing = service.pair();
      await vi.advanceTimersByTimeAsync(20000);
      await pairing;
      expect(service.flow()?.page).toBe('uncertain');
      const cancel = service.cancel();
      await vi.advanceTimersByTimeAsync(20000);
      await cancel;
      expect(calls('frame_cleanup')).toHaveLength(0);
      expect(service.pairingFor(device.id)).toBeUndefined();
      expect(service.flow()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the attempt when cleanup cannot reach the headset', async () => {
    handlers['frame_probe'] = () => ({ status: 'ok', hostKeyPin: 'PIN' });
    handlers['frame_setup'] = () => ({ status: 'failed', message: 'x', installed: false });
    handlers['frame_cleanup'] = () => ({ status: 'unreachable' });
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
    const service = new FramePairingService({} as any, {} as any);
    await service.init();
    expect(service.identityOf(device)).not.toBeNull();
    expect(service.identityOf({ ...device, typeName: 'Index' })).toBeNull();
    expect(service.identityOf({ ...device, manufacturer: undefined })).toBeNull();
    expect(service.identityOf({ ...device, id: 'OVR_Controller_X' })).toBeNull();
  });
});

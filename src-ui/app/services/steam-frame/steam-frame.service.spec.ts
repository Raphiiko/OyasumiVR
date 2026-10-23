import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameControllerOverrides, SteamFrameService } from './steam-frame.service';
import { of } from 'rxjs';
import { DMKnownDevice } from '../../models/device-manager';
import { OVRDevice } from '../../models/ovr-device';
import { SteamFrameConnectionState, SteamFramePairing } from '../../models/steam-frame';
import { ToastService } from '../toast.service';

const { invoke, store } = vi.hoisted(() => ({
  invoke: vi.fn(),
  store: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('../../globals', () => ({
  SETTINGS_STORE: store,
  SETTINGS_KEY_STEAM_FRAME_PAIRING: 'FRAME',
}));
vi.mock('../openvr.service', () => ({ OpenVRService: class {} }));
vi.mock('../../utils/secrets', () => ({
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

const openvr = { devices: of([]), setOverrides: vi.fn() } as any;

const storedPairing: SteamFramePairing = {
  id: 'PC-1',
  deviceId: device.id,
  identity: { serial: 'FPTEST000001', model: 'Deckard DV2', manufacturer: 'Valve' },
  address: '192.168.1.42',
  user: 'steamos',
  privateKey: 'KEY',
  publicKey: 'ssh-rsa AAA pc',
  token: 'T',
  hostKeyPin: 'PIN',
  certPin: 'CERT',
  port: 38440,
  complete: true,
  helperVersion: '1.0.0',
};

type Handler = (args: any) => unknown;
let handlers: Record<string, Handler>;
const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);

async function start() {
  const service = new SteamFrameService(openvr, {} as any);
  await service.init();
  return service;
}

beforeEach(() => {
  handlers = {
    steam_frame_get_supported_models: () => [{ manufacturer: 'Valve', model: 'Deckard DV2' }],
    steam_frame_get_connection_states: () => [],
    steam_frame_sync_connections: () => undefined,
    steam_frame_set_up_helper: () => ({
      status: 'complete',
      certPin: 'CERT',
      port: 38440,
      helperVersion: '1.0.0',
    }),
  };
  invoke.mockImplementation(async (command: string, args: any) => handlers[command](args));
  store.get.mockResolvedValue({
    version: 1,
    pairings: [{ ...storedPairing, privateKey: 'protected:KEY', token: 'protected:T' }],
  });
  store.set.mockResolvedValue(undefined);
  store.save.mockResolvedValue(undefined);
});

afterEach(() => vi.resetAllMocks());

describe('Steam Frame headsets', () => {
  it('offers pairing only for allowlisted headsets', async () => {
    const service = await start();
    expect(service.identityOf(device)).not.toBeNull();
    expect(service.identityOf({ ...device, typeName: 'Index' })).toBeNull();
    expect(service.identityOf({ ...device, manufacturer: undefined })).toBeNull();
    expect(service.identityOf({ ...device, id: 'OVR_Controller_X' })).toBeNull();
  });
});

describe('Steam Frame helper maintenance', () => {
  async function paired() {
    const service = await start();
    return { service, pairing: service.pairingFor(device.id)! };
  }

  it('starts a helper update for the pairing', async () => {
    handlers['steam_frame_update_helper'] = () => true;
    const { service, pairing } = await paired();
    await service.updateHelper(pairing);
    expect(calls('steam_frame_update_helper')).toEqual([{ pairingId: pairing.id }]);
  });

  it('disconnects a controller only on the paired headset that lists it as connected', async () => {
    handlers['steam_frame_disconnect_controller'] = () => undefined;
    const { service, pairing } = await paired();
    const connected = (pairingId: string, controllers: SteamFrameConnectionState['controllers']) =>
      (service as any).onConnectionState({ pairingId, status: 'connected', controllers });
    connected(pairing.id, [{ serial: 'C1', connected: true }]);
    connected('other', [{ serial: 'C1', connected: false }]);
    connected('removed', [{ serial: 'C1', connected: true }]);

    expect(await service.disconnectController('C1')).toBe(true);
    expect(calls('steam_frame_disconnect_controller')).toEqual([
      { pairingId: pairing.id, serial: 'C1' },
    ]);
    expect(await service.disconnectController('C2')).toBe(false);
  });

  it('pins the certificate of a reinstalled helper and reconnects with it', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'complete',
      certPin: 'NEW',
      port: 38441,
      helperVersion: '1.1.0',
    });
    await service.reinstallHelper(pairing);
    expect(calls('steam_frame_set_up_helper').at(-1).request).toMatchObject({
      pcId: pairing.id,
      identity: pairing.identity,
      repair: false,
    });
    expect(service.pairingFor(device.id)).toMatchObject({ certPin: 'NEW', port: 38441 });
    expect(calls('steam_frame_sync_connections').at(-1).pairings[0]).toMatchObject({
      certPin: 'NEW',
      port: 38441,
    });
    expect(service.reinstalls()).toEqual({});
  });

  it('asks setup to replace the helper on a repair', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({ status: 'failed', message: 'x' });
    await service.reinstallHelper(pairing, true);
    expect(calls('steam_frame_set_up_helper').at(-1).request).toMatchObject({ repair: true });
  });

  it('keeps the old pin after a failed reinstall', async () => {
    const { service, pairing } = await paired();
    handlers['steam_frame_set_up_helper'] = () => ({
      status: 'failed',
      message: 'x',
    });
    await service.reinstallHelper(pairing);
    expect(service.pairingFor(device.id)?.certPin).toBe('CERT');
    expect(service.reinstalls()).toEqual({});
  });
});

describe('Steam Frame forgetting', () => {
  it('forgets the pairing without contacting the headset', async () => {
    const service = await start();
    await service.removePairing(device.id);
    expect(calls('steam_frame_remove_access')).toHaveLength(0);
    expect(service.pairingFor(device.id)).toBeUndefined();
    expect(calls('steam_frame_sync_connections').at(-1).pairings).toEqual([]);
  });
});

describe('frameControllerOverrides', () => {
  const pairing = (id: string, serial: string) =>
    ({ id, identity: { serial } }) as SteamFramePairing;
  const state = (
    pairingId: string,
    controllers: SteamFrameConnectionState['controllers'],
    status: SteamFrameConnectionState['status'] = 'connected'
  ) => ({ pairingId, status, controllers }) as SteamFrameConnectionState;

  it('reports the controllers of a headset only while it streams here', () => {
    const states = {
      a: state('a', [
        { serial: 'C1', connected: true },
        { serial: 'C2', connected: false },
      ]),
    };
    const pairings = [pairing('a', 'HMD-A')];
    expect(frameControllerOverrides(states, pairings, ['HMD-A'])).toEqual({
      C1: { powerMethod: 'SteamFrame', isConnected: true, canPowerOff: true },
      C2: { powerMethod: 'SteamFrame', isConnected: false, canPowerOff: false },
    });
    expect(frameControllerOverrides(states, pairings, [])).toEqual({});
  });

  it('skips headsets whose helper is not connected', () => {
    const states = { a: state('a', [{ serial: 'C1', connected: true }], 'offline') };
    expect(frameControllerOverrides(states, [pairing('a', 'HMD-A')], ['HMD-A'])).toEqual({});
  });

  it('takes a shared controller only from the headset that streams here', () => {
    const states = {
      a: state('a', [{ serial: 'C1', connected: false }]),
      b: state('b', [{ serial: 'C1', connected: true }]),
    };
    const pairings = [pairing('a', 'HMD-A'), pairing('b', 'HMD-B')];
    expect(frameControllerOverrides(states, pairings, ['HMD-A'])['C1'].isConnected).toBe(false);
  });
});

describe('SteamFrameService controller turn-off', () => {
  const frameController: OVRDevice = {
    index: 3,
    class: 'Controller',
    role: 'LeftHand',
    battery: 0.5,
    pose: null,
    serialNumber: 'FRAME-L',
    powerMethod: 'SteamFrame',
    isConnected: true,
    canPowerOff: true,
    isTurningOff: false,
  };

  function setup(disconnect: () => Promise<boolean>) {
    const openvr = { devices: of([frameController]), setTurningOff: vi.fn() };
    const toasts = new ToastService();
    const service = new SteamFrameService(openvr as any, toasts);
    const disconnectController = vi
      .spyOn(service, 'disconnectController')
      .mockImplementation(disconnect);
    return { service, openvr, toasts, disconnectController };
  }

  it('turns off the current device for a copy held from before the helper reported', async () => {
    const { service, disconnectController } = setup(async () => true);
    const stale: OVRDevice = { ...frameController, powerMethod: 'None', canPowerOff: false };
    expect(await service.turnOffDevices([stale])).toEqual([frameController]);
    expect(disconnectController).toHaveBeenCalledExactlyOnceWith('FRAME-L');
  });

  it('sends one disconnect for requests that overlap', async () => {
    const { service, disconnectController } = setup(async () => true);
    const results = await Promise.all([
      service.turnOffDevices([frameController]),
      service.turnOffDevices([frameController]),
    ]);
    expect(disconnectController).toHaveBeenCalledOnce();
    expect(results.flat()).toHaveLength(1);
  });

  it('shows no failure for a second press while the first disconnect is on its way', async () => {
    let reply!: (sent: boolean) => void;
    const { service, toasts } = setup(() => new Promise((resolve) => (reply = resolve)));
    const toast = vi.spyOn(toasts, 'show');
    const first = service.turnOffDeviceForUser(frameController, 'Left');
    await vi.waitFor(() => expect(reply).toBeDefined());
    expect(await service.turnOffDeviceForUser(frameController, 'Left')).toEqual([]);
    reply(true);
    expect(await first).toEqual([frameController]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('marks the controller busy only once the disconnect went out', async () => {
    const failed = setup(async () => false);
    expect(await failed.service.turnOffDevices([frameController])).toEqual([]);
    expect(failed.openvr.setTurningOff).not.toHaveBeenCalled();

    const sent = setup(async () => true);
    await sent.service.turnOffDevices([frameController]);
    expect(sent.openvr.setTurningOff).toHaveBeenCalledExactlyOnceWith(3, true);
  });
});

import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceManagerService } from './device-manager.service';
import { ShutdownAutomationsService } from './shutdown-automations.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import type { DeviceManagerData, DeviceSelection, DMKnownDevice } from '../models/device-manager';
import type { OVRDevice } from '../models/ovr-device';
import type { LighthouseDevice } from '../models/lighthouse-device';

const { get, set, invoke } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), invoke: vi.fn() }));
vi.mock('../globals', () => ({
  SETTINGS_KEY_DEVICE_MANAGER: 'DEVICE_MANAGER',
  SETTINGS_STORE: { get, set },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn() }));

const tag = { id: 'TAG_A', name: 'Selected', color: '#ffffff' };
const selection: DeviceSelection = { devices: [], types: [], tagIds: [tag.id] };
type DMDependencies = ConstructorParameters<typeof DeviceManagerService>;

function appSettings(settings = APP_SETTINGS_DEFAULT) {
  const subject = new BehaviorSubject(settings);
  return {
    settings: subject,
    updateSettings: vi.fn((update) => subject.next({ ...subject.value, ...update })),
  } as unknown as DMDependencies[2] & { settings: BehaviorSubject<typeof settings> };
}
type ShutdownDependencies = ConstructorParameters<typeof ShutdownAutomationsService>;

async function setup(kind: 'OVR' | 'LH' = 'OVR') {
  const ovr = new BehaviorSubject<OVRDevice[]>(
    kind === 'OVR'
      ? ['A', 'B'].map(
          (serialNumber, index) =>
            ({
              index,
              serialNumber,
              class: 'Controller',
              canPowerOff: true,
              isTurningOff: false,
            }) as OVRDevice
        )
      : []
  );
  const lh = new BehaviorSubject<LighthouseDevice[]>(
    kind === 'LH'
      ? ['A', 'B'].map(
          (id) => ({ id, powerState: 'on', deviceType: 'lighthouseV2' }) as LighthouseDevice
        )
      : []
  );
  const known = ['A', 'B'].map(
    (id, index) =>
      ({
        id: `${kind}_${kind === 'OVR' ? 'Controller' : 'lighthouseV2'}_${id}`,
        defaultName: id,
        typeName: id,
        deviceType: kind === 'OVR' ? 'CONTROLLER' : 'LIGHTHOUSE',
        tagIds: index === 0 ? [tag.id] : [],
        disabled: false,
        lastSeen: 0,
      }) as DMKnownDevice
  );
  get.mockResolvedValue({
    version: 2,
    knownDevices: known,
    tags: [tag],
  } satisfies DeviceManagerData);
  const manager = new DeviceManagerService(
    { devices: ovr } as unknown as DMDependencies[0],
    { devices: lh } as unknown as DMDependencies[1],
    appSettings()
  );
  await manager['loadData']();
  return { manager, ovr, lh, known };
}

const mutations = {
  disable: (manager: DeviceManagerService, known: DMKnownDevice[]) =>
    manager.disableKnownDevice(known[0], true),
  untag: (manager: DeviceManagerService, known: DMKnownDevice[]) =>
    manager.removeTagFromKnownDevice(known[0], tag),
  deleteTag: (manager: DeviceManagerService) => manager.deleteTag(tag.id),
  addTag: (manager: DeviceManagerService, known: DMKnownDevice[]) =>
    manager.addTagToKnownDevice(known[1], tag),
};

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe.each(['OVR', 'LH'] as const)('%s selection membership', (kind) => {
  it.each(Object.keys(mutations) as (keyof typeof mutations)[])(
    'emits synchronously after %s with fixed physical IDs',
    async (mutation) => {
      const h = await setup(kind);
      const seen: string[][] = [];
      const sub = h.manager
        .getDevicesForSelectionStream(selection)
        .subscribe((result) => seen.push(result.knownDevices.map((d) => d.id)));
      expect(seen).toEqual([[h.known[0].id]]);
      mutations[mutation](h.manager, h.known);
      expect(seen.at(-1)).toEqual(mutation === 'addTag' ? [h.known[0].id, h.known[1].id] : []);
      expect(seen).toHaveLength(2);
      sub.unsubscribe();
    }
  );

  it.each(Object.keys(mutations) as (keyof typeof mutations)[])(
    'shutdown immediately consumes %s without a physical emission',
    async (mutation) => {
      vi.useFakeTimers();
      const h = await setup(kind);
      const configs = new BehaviorSubject({
        ...structuredClone(AUTOMATION_CONFIGS_DEFAULT),
        SHUTDOWN_AUTOMATIONS: {
          ...AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS,
          turnOffDevices: selection,
          quitSteamVR: false,
          powerDownWindows: false,
          triggersEnabled: false,
        },
      });
      const powerOff = vi.fn((devices: OVRDevice[]) =>
        h.ovr.next(
          h.ovr.value.map((d) =>
            devices.some((selected) => selected.serialNumber === d.serialNumber)
              ? { ...d, canPowerOff: false }
              : d
          )
        )
      );
      const setPowerState = vi.fn(
        async (device: LighthouseDevice, state: LighthouseDevice['powerState']) => {
          h.lh.next(h.lh.value.map((d) => (d.id === device.id ? { ...d, powerState: state } : d)));
          return true;
        }
      );
      const shutdown = new ShutdownAutomationsService(
        { mode: new BehaviorSubject(false) } as unknown as ShutdownDependencies[0],
        { configs } as unknown as ShutdownDependencies[1],
        {
          settingsSync: { ...APP_SETTINGS_DEFAULT, lighthousePowerControl: true },
        } as ShutdownDependencies[2],
        { devices: h.ovr } as unknown as ShutdownDependencies[3],
        { turnOffDevices: powerOff } as unknown as ShutdownDependencies[4],
        {
          devices: h.lh,
          setPowerState,
          deviceNeedsIdentifier: () => false,
        } as unknown as ShutdownDependencies[5],
        { logEvent: vi.fn() } as unknown as ShutdownDependencies[6],
        {} as ShutdownDependencies[7],
        {
          world: new BehaviorSubject({ players: [], loaded: false }),
          vrchatProcessActive: new BehaviorSubject(false),
        } as unknown as ShutdownDependencies[8],
        h.manager
      );
      await shutdown.init();
      expect(shutdown.getApplicableStages()).toEqual(['TURNING_OFF_DEVICES']);
      mutations[mutation](h.manager, h.known);
      expect(shutdown.getApplicableStages()).toEqual(
        mutation === 'addTag' ? ['TURNING_OFF_DEVICES'] : []
      );
      const sequence = shutdown.runSequence('MANUAL');
      await vi.advanceTimersByTimeAsync(3000);
      await sequence;
      if (mutation === 'addTag' && kind === 'OVR')
        expect(powerOff.mock.calls[0][0].map((d) => d.serialNumber)).toEqual(['A', 'B']);
      else expect(powerOff).not.toHaveBeenCalled();
      if (mutation === 'addTag' && kind === 'LH')
        expect(setPowerState.mock.calls.map(([d]) => d.id)).toEqual(['A', 'B']);
      else expect(setPowerState).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    }
  );
});

it('suppresses nickname, tag appearance, and telemetry edits', async () => {
  const h = await setup();
  const emit = vi.fn();
  const sub = h.manager.getDevicesForSelectionStream(selection).subscribe(emit);
  h.manager.setNicknameForKnownDevice(h.known[0], 'New nickname');
  h.manager.updateTag(tag.id, 'New label', '#000000');
  h.ovr.next(h.ovr.value.map((d) => ({ ...d, battery: 50 })));
  expect(emit).toHaveBeenCalledTimes(1);
  sub.unsubscribe();
});

it.each(['type', 'individual', 'tag'] as const)(
  'preserves disabled filtering and recovery for %s selection',
  async (mode) => {
    const h = await setup();
    const selected: DeviceSelection =
      mode === 'type'
        ? { devices: [], types: ['CONTROLLER'], tagIds: [] }
        : mode === 'individual'
          ? { devices: ['OVR_Controller_A'], types: [], tagIds: [] }
          : selection;
    h.manager.disableKnownDevice(h.known[0], true);
    const disabled = await h.manager.getDevicesForSelection(selected);
    expect(disabled.ovrDevices.map((d) => d.serialNumber)).toEqual(mode === 'type' ? ['B'] : []);
    h.manager.disableKnownDevice(h.known[0], false);
    const enabled = await h.manager.getDevicesForSelection(selected);
    expect(enabled.ovrDevices.map((d) => d.serialNumber)).toEqual(
      mode === 'type' ? ['A', 'B'] : ['A']
    );
  }
);

it('refreshes when an OpenVR index is reused by another serial', async () => {
  const h = await setup();
  const seen: string[][] = [];
  const sub = h.manager
    .getDevicesForSelectionStream(selection)
    .subscribe((result) => seen.push(result.ovrDevices.map((d) => d.serialNumber!)));
  h.ovr.next([{ ...h.ovr.value[0], serialNumber: 'C' }, h.ovr.value[1]]);
  expect(seen).toEqual([['A'], []]);
  sub.unsubscribe();
});

it('tells the core which base stations are disabled, by address and type', async () => {
  const knownDevice = (id: string, disabled: boolean): DMKnownDevice => ({
    id,
    defaultName: id,
    typeName: id,
    deviceType: id.startsWith('LH_') ? 'LIGHTHOUSE' : 'CONTROLLER',
    tagIds: [],
    disabled,
    lastSeen: 0,
  });
  const enabledStation = knownDevice('LH_lighthouseV2_AA:BB:CC:DD:EE:03', false);
  get.mockResolvedValue({
    version: 2,
    knownDevices: [
      knownDevice('LH_lighthouseV2_AA:BB:CC:DD:EE:01', true),
      knownDevice('LH_lighthouseV1_AA:BB:CC:DD:EE:02', true),
      enabledStation,
      knownDevice('OVR_Controller_LHR-0001', true),
    ],
    tags: [],
  } satisfies DeviceManagerData);
  const setDisabledDevices = vi.fn(async () => {});
  const manager = new DeviceManagerService(
    { devices: new BehaviorSubject<OVRDevice[]>([]) } as unknown as DMDependencies[0],
    {
      devices: new BehaviorSubject<LighthouseDevice[]>([]),
      setDisabledDevices,
    } as unknown as DMDependencies[1],
    appSettings()
  );

  await manager.init();
  expect(setDisabledDevices).toHaveBeenLastCalledWith([
    { id: 'AA:BB:CC:DD:EE:01', deviceType: 'lighthouseV2' },
    { id: 'AA:BB:CC:DD:EE:02', deviceType: 'lighthouseV1' },
  ]);

  manager.disableKnownDevice(enabledStation, true);
  await Promise.resolve();
  expect(setDisabledDevices).toHaveBeenLastCalledWith([
    { id: 'AA:BB:CC:DD:EE:01', deviceType: 'lighthouseV2' },
    { id: 'AA:BB:CC:DD:EE:02', deviceType: 'lighthouseV1' },
    { id: 'AA:BB:CC:DD:EE:03', deviceType: 'lighthouseV2' },
  ]);
});

it('copies the migrated headset values once SteamVR reports the first headset', async () => {
  get.mockResolvedValue({ version: 2, knownDevices: [], tags: [] } satisfies DeviceManagerData);
  const settings = appSettings({
    ...APP_SETTINGS_DEFAULT,
    legacyHmdSettings: { valveIndex: { maxBrightness: 130 }, bigscreenBeyond: {}, allHmds: {} },
  });
  const ovr = new BehaviorSubject<OVRDevice[]>([]);
  const manager = new DeviceManagerService(
    { devices: ovr } as unknown as DMDependencies[0],
    {
      devices: new BehaviorSubject<LighthouseDevice[]>([]),
      setDisabledDevices: vi.fn(async () => {}),
    } as unknown as DMDependencies[1],
    settings
  );

  await manager.init();
  expect(settings.settings.value.legacyHmdSettings).not.toBeNull();

  ovr.next([
    {
      index: 0,
      class: 'HMD',
      manufacturerName: 'Valve',
      modelNumber: 'Index',
      serialNumber: 'LHR-TEST0001',
    } as OVRDevice,
  ]);
  expect(settings.settings.value).toMatchObject({
    legacyHmdSettings: null,
    hmdSettings: { 'OVR_HMD_LHR-TEST0001': { maxBrightness: 130 } },
  });
});

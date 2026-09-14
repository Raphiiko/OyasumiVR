import '@angular/compiler';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { EventLogService } from './event-log.service';
import { DeviceListItemComponent } from '../components/device-list/device-list-item/device-list-item.component';
import { DeviceListComponent } from '../components/device-list/device-list.component';
import { HotkeyHandlerService } from './hotkey-handler.service';
import { CommandOscMethod } from './osc-control/methods/command.osc-method';
import { SleepDevicePowerAutomationsService } from './power-automations/sleep-device-power-automations.service';
import { TurnOffDevicesOnBatteryLevelAutomationService } from './power-automations/turn-off-devices-on-battery-level-automation.service';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import type { OVRDevice } from '../models/ovr-device';
import type { OSCIntValue } from '../models/osc-message';
import en from '../../assets/i18n/en.json';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));

const controller: OVRDevice = {
  index: 1,
  class: 'Controller',
  role: 'LeftHand',
  battery: 0.2,
  pose: null,
  serialNumber: 'CONTROLLER',
  dongleId: 'DONGLE-C',
  canPowerOff: true,
  isTurningOff: false,
};
const tracker: OVRDevice = {
  ...controller,
  index: 2,
  class: 'GenericTracker',
  serialNumber: 'TRACKER',
  dongleId: 'DONGLE-T',
};
const path = 'C:\\fixture\\lighthouse_console.exe';

function caller<T>(prototype: T, context: object): T {
  return Object.assign(Object.create(prototype), context);
}

async function createConsole(devices: OVRDevice[], valid = true) {
  const settings = new BehaviorSubject({ ...APP_SETTINGS_DEFAULT, lighthouseConsolePath: '' });
  const currentDevices = new BehaviorSubject(devices);
  const service = new LighthouseConsoleService(
    {
      settings,
      updateSettings: (patch: object) => settings.next({ ...settings.value, ...patch }),
    } as unknown as ConstructorParameters<typeof LighthouseConsoleService>[0],
    {
      devices: currentDevices,
      onDeviceUpdate: (device: OVRDevice) =>
        currentDevices.next(
          currentDevices.value.map((current) => (current.index === device.index ? device : current))
        ),
    } as unknown as ConstructorParameters<typeof LighthouseConsoleService>[1]
  );
  await vi.advanceTimersByTimeAsync(0);
  invoke.mockResolvedValue({
    stdout: valid ? 'Version:  lighthouse_console.exe 1.0' : 'unexpected banner',
    stderr: '',
    status: 0,
  });
  await service.setConsolePath(path);
  invoke.mockClear();
  return { service, settings, currentDevices };
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('power-off command results and actual event log', () => {
  it.each(['blocked', 'filtered', 'empty'] as const)(
    'adds no event for a %s request',
    async (mode) => {
      const devices =
        mode === 'filtered'
          ? [
              { ...controller, dongleId: undefined },
              { ...tracker, isTurningOff: true },
              { ...controller, index: 3, serialNumber: 'NO-POWER', canPowerOff: false },
            ]
          : [controller];
      const { service } = await createConsole(devices, mode !== 'blocked');
      if (mode === 'empty') expect(await service.turnOffDevices([])).toEqual([]);
      const log = new EventLogService();
      const list = caller(DeviceListComponent.prototype, {
        lighthouseConsole: service,
        eventLog: log,
        deviceManager: { getIdForOpenVRDevice: () => '', getKnownDeviceById: () => undefined },
        deviceCategories: [{ type: 'OpenVR', devices: mode === 'empty' ? [] : devices }],
      });
      await list.turnOffAllOVRDevices();
      expect(invoke).not.toHaveBeenCalled();
      expect((await firstValueFrom(log.eventLog)).logs).toEqual([]);
    }
  );

  it.each(['rejected', 'nonzero'] as const)(
    'records no success when a single-device command is %s',
    async (failure) => {
      const { service } = await createConsole([controller]);
      if (failure === 'rejected') invoke.mockRejectedValueOnce(new Error('unreachable dongle'));
      else invoke.mockResolvedValueOnce({ status: 1 });
      const log = new EventLogService();
      const item = caller(DeviceListItemComponent.prototype, {
        lighthouseConsole: service,
        eventLog: log,
        mode: 'openvr',
        _ovrDevice: controller,
      });
      await item.clickDevicePowerButton();
      expect(invoke).toHaveBeenCalledOnce();
      expect((await firstValueFrom(log.eventLog)).logs).toEqual([]);
    }
  );

  it('logs only the successful class after rejection and nonzero exit, then runs the next batch', async () => {
    const failedTracker = { ...tracker, index: 3, serialNumber: 'FAILED-T', dongleId: 'FAILED-D' };
    const nextController = { ...controller, index: 4, serialNumber: 'NEXT-C', dongleId: 'NEXT-D' };
    const { service } = await createConsole([controller, tracker, failedTracker, nextController]);
    invoke
      .mockRejectedValueOnce(new Error('unreachable dongle'))
      .mockResolvedValueOnce({ status: 0 })
      .mockResolvedValueOnce({ status: 1 })
      .mockResolvedValueOnce({ status: 0 });
    const log = new EventLogService();
    const first = service.turnOffDevices([controller, tracker, failedTracker]);
    const second = service.turnOffDevices([nextController]);
    log.logTurnedOffOpenVRDevices(await first, 'MANUAL');
    log.logTurnedOffOpenVRDevices(await second, 'HOTKEY');
    expect(invoke.mock.calls.map(([, args]) => args.args[1])).toEqual([
      'DONGLE-C',
      'DONGLE-T',
      'FAILED-D',
      'NEXT-D',
    ]);
    expect((await firstValueFrom(log.eventLog)).logs).toMatchObject([
      { type: 'turnedOffOpenVRDevices', reason: 'HOTKEY', devices: 'CONTROLLER' },
      { type: 'turnedOffOpenVRDevices', reason: 'MANUAL', devices: 'TRACKER' },
    ]);
  });

  it('retains an earlier successful dispatch when console validation changes mid-batch', async () => {
    const { service } = await createConsole([controller, tracker]);
    invoke.mockImplementationOnce(async () => {
      await service.setConsolePath('invalid');
      return { status: 0 };
    });
    expect(await service.turnOffDevices([controller, tracker])).toEqual([controller]);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('keeps optional spacing and serial matching against current device indices', async () => {
    const { service, settings } = await createConsole([{ ...controller, index: 9 }, tracker]);
    settings.next({ ...settings.value, lighthousePowerOffDelay: true });
    const pending = service.turnOffDevices([controller, tracker, controller]);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect((await pending).map((device) => device.index)).toEqual([9, 2]);
  });

  it.each([
    [[controller], 'CONTROLLER'],
    [[controller, { ...controller, index: 3 }], 'CONTROLLERS'],
    [[tracker], 'TRACKER'],
    [[tracker, { ...tracker, index: 3 }], 'TRACKERS'],
    [[controller, tracker], 'VARIOUS'],
  ] as const)(
    'derives the event category from successful devices: %s',
    async (devices, category) => {
      const log = new EventLogService();
      log.logTurnedOffOpenVRDevices([...devices], 'BATTERY_LEVEL', { batteryThreshold: 20 });
      expect((await firstValueFrom(log.eventLog)).logs).toMatchObject([
        { devices: category, reason: 'BATTERY_LEVEL', batteryThreshold: 20 },
      ]);
    }
  );
});

describe('power-off event producers', () => {
  describe.each(['manual', 'osc'] as const)('%s all-devices action', (source) => {
    it.each(['full', 'single', 'partial', 'skipped', 'failed'] as const)(
      'preserves action context for %s results',
      async (outcome) => {
        const devices: OVRDevice[] =
          outcome === 'single'
            ? [controller]
            : [controller, outcome === 'skipped' ? { ...tracker, dongleId: undefined } : tracker];
        devices.push({
          ...controller,
          index: 10,
          serialNumber: 'HMD',
          class: 'HMD',
          canPowerOff: false,
        });
        const { service } = await createConsole(devices);
        if (outcome === 'partial')
          invoke.mockResolvedValueOnce({ status: 0 }).mockResolvedValueOnce({ status: 1 });
        if (outcome === 'failed') invoke.mockResolvedValue({ status: 1 });
        const log = new EventLogService();
        if (source === 'manual') {
          await caller(DeviceListComponent.prototype, {
            lighthouseConsole: service,
            eventLog: log,
            deviceManager: { getIdForOpenVRDevice: () => '', getKnownDeviceById: () => undefined },
            deviceCategories: [{ type: 'OpenVR', devices }],
          }).turnOffAllOVRDevices();
        } else {
          await caller(CommandOscMethod.prototype, {
            lighthouseConsole: service,
            eventLog: log,
            openvr: { devices: new BehaviorSubject(devices) },
          }).handleOSCMessage({
            address: '/OyasumiVR/Command',
            values: [{ kind: 'int', value: 4 } as OSCIntValue],
          });
          await vi.advanceTimersByTimeAsync(1999);
          expect(invoke).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
        }
        const logs = (await firstValueFrom(log.eventLog)).logs;
        if (outcome === 'failed') {
          expect(logs).toEqual([]);
          return;
        }
        const category = outcome === 'full' || outcome === 'single' ? 'ALL' : 'CONTROLLER';
        expect(logs).toMatchObject([
          { devices: category, reason: source === 'manual' ? 'MANUAL' : 'OSC_CONTROL' },
        ]);
        expect(en.comp['event-log-entry'].type.turnedOffOpenVRDevices.title[category]).toBe(
          category === 'ALL' ? 'Turned off all devices' : 'Turned off a controller'
        );
      }
    );
  });

  it.each(['failed', 'skipped', 'partial'] as const)(
    'sleep handles %s base-station results',
    async (outcome) => {
      const log = new EventLogService();
      const powerOff = vi.fn(async (device: { id: string }) => {
        if (device.id === 'FAILED') throw new Error('unreachable');
      });
      const service = caller(SleepDevicePowerAutomationsService.prototype, {
        config: AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS,
        appSettings: { settingsSync: APP_SETTINGS_DEFAULT },
        deviceManager: {
          getDevicesForSelection: async () => ({
            ovrDevices: [],
            lighthouseDevices:
              outcome === 'skipped'
                ? [{ id: 'V1', powerState: 'on' }]
                : [
                    { id: 'FAILED', powerState: 'on' },
                    ...(outcome === 'partial' ? [{ id: 'OK', powerState: 'on' }] : []),
                  ],
          }),
        },
        lighthouseConsole: { turnOffDevices: async () => [] },
        lighthouse: { deviceNeedsIdentifier: () => outcome === 'skipped', setPowerState: powerOff },
        eventLog: log,
      });
      if (outcome === 'skipped') {
        await service['handleSleepModeEnable']();
        expect(powerOff).not.toHaveBeenCalled();
      } else await expect(service['handleSleepModeEnable']()).rejects.toThrow('unreachable');
      const logs = (await firstValueFrom(log.eventLog)).logs;
      if (outcome === 'partial')
        expect(logs).toMatchObject([{ devices: 'VARIOUS', reason: 'SLEEP_MODE_ENABLED' }]);
      else expect(logs).toEqual([]);
    }
  );

  it.each(['handleSleepModeEnable', 'handleSleepModeDisable', 'handleSleepPreparation'] as const)(
    '%s keeps a successful base-station-only event',
    async (method) => {
      const log = new EventLogService();
      const service = caller(SleepDevicePowerAutomationsService.prototype, {
        config: AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS,
        appSettings: { settingsSync: APP_SETTINGS_DEFAULT },
        deviceManager: {
          getDevicesForSelection: vi
            .fn()
            .mockResolvedValueOnce({
              ovrDevices: [],
              lighthouseDevices: [{ id: 'BASE', powerState: 'on' }],
            })
            .mockResolvedValue({ ovrDevices: [], lighthouseDevices: [], knownDevices: [] }),
        },
        lighthouseConsole: { turnOffDevices: async () => [] },
        lighthouse: { deviceNeedsIdentifier: () => false, setPowerState: vi.fn(async () => {}) },
        eventLog: log,
      });
      await service[method]();
      expect((await firstValueFrom(log.eventLog)).logs).toMatchObject([{ devices: 'VARIOUS' }]);
    }
  );

  it.each([
    ['handleSleepModeEnable', 'SLEEP_MODE_ENABLED'],
    ['handleSleepModeDisable', 'SLEEP_MODE_DISABLED'],
    ['handleSleepPreparation', 'SLEEP_PREPARATION'],
  ] as const)('%s records OpenVR success after a base-station failure', async (method, reason) => {
    let finish!: (devices: OVRDevice[]) => void;
    const log = new EventLogService();
    const service = caller(SleepDevicePowerAutomationsService.prototype, {
      config: AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS,
      appSettings: { settingsSync: APP_SETTINGS_DEFAULT },
      deviceManager: {
        getDevicesForSelection: async () => ({
          ovrDevices: [controller],
          lighthouseDevices: [{ id: 'BASE', powerState: 'on' }],
        }),
      },
      lighthouseConsole: {
        turnOffDevices: () => new Promise<OVRDevice[]>((resolve) => (finish = resolve)),
      },
      lighthouse: {
        deviceNeedsIdentifier: () => false,
        setPowerState: async () => {
          throw new Error('base station unreachable');
        },
      },
      eventLog: log,
    });
    const pending = expect(service[method]()).rejects.toThrow('base station unreachable');
    await vi.advanceTimersByTimeAsync(0);
    expect((await firstValueFrom(log.eventLog)).logs).toEqual([]);
    finish([controller]);
    await pending;
    expect((await firstValueFrom(log.eventLog)).logs).toMatchObject([
      { type: 'turnedOffOpenVRDevices', devices: 'VARIOUS', reason },
    ]);
  });

  it.each([
    ['single', 'MANUAL'],
    ['category', 'MANUAL'],
    ['all', 'MANUAL'],
    ['hotkeyControllers', 'HOTKEY'],
    ['hotkeyTrackers', 'HOTKEY'],
    ['oscTrackers', 'OSC_CONTROL'],
    ['oscControllers', 'OSC_CONTROL'],
    ['oscAll', 'OSC_CONTROL'],
    ['sleepEnable', 'SLEEP_MODE_ENABLED'],
    ['sleepDisable', 'SLEEP_MODE_DISABLED'],
    ['sleepPreparation', 'SLEEP_PREPARATION'],
    ['battery', 'BATTERY_LEVEL'],
  ])('%s waits for successful results before recording %s', async (source, reason) => {
    let finish!: (devices: OVRDevice[]) => void;
    const powerOff = vi.fn(
      () =>
        new Promise<OVRDevice[]>((resolve) => {
          finish = resolve;
        })
    );
    const log = new EventLogService();
    const record = vi.spyOn(log, 'logTurnedOffOpenVRDevices');
    const devices = new BehaviorSubject([controller, tracker]);
    const consoleService = { turnOffDevices: powerOff };
    const deviceManager = {
      getIdForOpenVRDevice: () => '',
      getKnownDeviceById: () => undefined,
      getDevicesForSelection: vi.fn(async () => ({
        ovrDevices: devices.value,
        lighthouseDevices: [],
        knownDevices: [],
      })),
    };
    const context = {
      lighthouseConsole: consoleService,
      lighthouseConsoleService: consoleService,
      lighthouse: consoleService,
      eventLog: log,
      openvr: { devices },
      deviceManager,
      appSettings: { settingsSync: APP_SETTINGS_DEFAULT },
      config: {
        ...AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS,
        turnOffDevicesBelowBatteryLevel_onlyWhileAsleep: false,
        turnOffDevicesBelowBatteryLevel_threshold: 20,
      },
    };
    const category = {
      type: 'OpenVR' as const,
      class: 'Controller' as const,
      label: '',
      devices: [controller],
      canBulkPowerOff: true,
    };
    let pending: Promise<unknown>;
    switch (source) {
      case 'single':
        pending = caller(DeviceListItemComponent.prototype, {
          ...context,
          mode: 'openvr',
          _ovrDevice: controller,
        }).clickDevicePowerButton();
        break;
      case 'category':
        pending = caller(DeviceListComponent.prototype, context).turnOffOVRDevices(category);
        break;
      case 'all':
        pending = caller(DeviceListComponent.prototype, {
          ...context,
          deviceCategories: [category],
        }).turnOffAllOVRDevices();
        break;
      case 'hotkeyControllers':
      case 'hotkeyTrackers':
        pending = caller(HotkeyHandlerService.prototype, context)[
          source === 'hotkeyControllers' ? 'turnOffControllerDevices' : 'turnOffTrackerDevices'
        ]();
        break;
      case 'oscTrackers':
      case 'oscControllers':
      case 'oscAll':
        pending = caller(CommandOscMethod.prototype, context).handleOSCMessage({
          address: '/OyasumiVR/Command',
          values: [
            {
              kind: 'int',
              value: source === 'oscTrackers' ? 2 : source === 'oscControllers' ? 3 : 4,
            } as import('../models/osc-message').OSCIntValue,
          ],
        });
        break;
      case 'battery':
        pending = caller(TurnOffDevicesOnBatteryLevelAutomationService.prototype, context)[
          'processBatteryChange'
        ](controller, 0.2, 0.1, false);
        break;
      default:
        pending = caller(SleepDevicePowerAutomationsService.prototype, context)[
          source === 'sleepEnable'
            ? 'handleSleepModeEnable'
            : source === 'sleepDisable'
              ? 'handleSleepModeDisable'
              : 'handleSleepPreparation'
        ]();
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(powerOff).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
    const dispatched =
      source === 'hotkeyTrackers' || source === 'oscTrackers'
        ? [tracker]
        : source === 'oscAll'
          ? [controller, tracker]
          : [controller];
    finish(dispatched);
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    if (!source.startsWith('sleep'))
      expect(record.mock.calls[0].slice(0, 2)).toEqual([dispatched, reason]);
    expect((await firstValueFrom(log.eventLog)).logs).toMatchObject([
      {
        devices: source.startsWith('sleep')
          ? 'VARIOUS'
          : source === 'all' || source === 'oscAll'
            ? 'ALL'
            : source === 'hotkeyTrackers' || source === 'oscTrackers'
              ? 'TRACKER'
              : 'CONTROLLER',
        reason,
      },
    ]);
  });
});

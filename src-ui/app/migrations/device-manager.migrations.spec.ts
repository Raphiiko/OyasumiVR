import { describe, expect, it } from 'vitest';
import { runMigrations, Versioned } from 'src-shared-ts/src/migration-runner';
import { decideStoreMigration } from 'src-shared-ts/src/store-migration';
import { DEVICE_MANAGER_MIGRATION } from './device-manager.migrations';
import { SETTINGS_STORE_MIGRATION } from './store-migrations';

describe('device manager migration 2 to 3', () => {
  const hmd = (id: string, typeName: string, manufacturer?: string) => ({
    id: `OVR_HMD_${id}`,
    typeName,
    manufacturer,
    deviceType: 'HMD',
  });

  it('moves the changed global headset values to the known headsets of their model', async () => {
    const store = {
      APP_SETTINGS: {
        version: 18,
        valveIndexMaxBrightness: 130,
        bigscreenBeyondMaxBrightness: 200,
        bigscreenBeyondUnsafeBrightness: true,
        hardwareBrightnessOnUnsupportedHmds: false,
        cctControlOnUnsupportedHmds: true,
      },
      DEVICE_MANAGER: {
        version: 2,
        tags: [],
        knownDevices: [
          hmd('LHR-TEST0001', 'Index', 'Valve'),
          hmd('BSB-TEST0002', 'Beyond', 'Bigscreen'),
          hmd('FRM-TEST0003', 'Steam Frame', 'Valve'),
          hmd('OTH-TEST0004', 'Visor X', 'Example'),
          // headsets stored before the device manager recorded manufacturers
          hmd('LHR-TEST0005', 'Index'),
          hmd('FRM-TEST0006', 'Deckard MP'),
          hmd('PSV-TEST0007', 'PS VR2'),
          hmd('OTH-TEST0008', 'Visor Y'),
          { id: 'OVR_CONTROLLER_LHR-TEST0009', typeName: 'Knuckles', deviceType: 'CONTROLLER' },
        ],
      },
    };

    const decision = await decideStoreMigration(
      [{ id: 'live', kind: 'live', contents: JSON.stringify(store) }],
      SETTINGS_STORE_MIGRATION
    );

    expect(decision.action).toBe('install');
    if (decision.action !== 'install') return;
    const { APP_SETTINGS, DEVICE_MANAGER } = JSON.parse(decision.contents);
    expect(DEVICE_MANAGER.version).toBe(3);
    const devices = Object.fromEntries(
      DEVICE_MANAGER.knownDevices.map((d: any) => [d.id, [d.manufacturer, d.settings]])
    );
    expect(devices).toEqual({
      'OVR_HMD_LHR-TEST0001': ['Valve', { model: 'VALVE_INDEX', maxBrightness: 130 }],
      'OVR_HMD_BSB-TEST0002': ['Bigscreen', { model: 'BIGSCREEN_BEYOND', maxBrightness: 200 }],
      'OVR_HMD_FRM-TEST0003': ['Valve', undefined],
      'OVR_HMD_OTH-TEST0004': ['Example', { model: 'OTHER_HMD', cctControlOnUnsupportedHmd: true }],
      'OVR_HMD_LHR-TEST0005': ['Valve', { model: 'VALVE_INDEX', maxBrightness: 130 }],
      'OVR_HMD_FRM-TEST0006': ['Valve', undefined],
      'OVR_HMD_PSV-TEST0007': ['SIE', undefined],
      'OVR_HMD_OTH-TEST0008': [undefined, { model: 'OTHER_HMD', cctControlOnUnsupportedHmd: true }],
      'OVR_CONTROLLER_LHR-TEST0009': [undefined, undefined],
    });
    expect(APP_SETTINGS.version).toBe(19);
    expect(APP_SETTINGS.bigscreenBeyondUnsafeBrightness).toBe(true);
    for (const key of [
      'valveIndexMaxBrightness',
      'bigscreenBeyondMaxBrightness',
      'hardwareBrightnessOnUnsupportedHmds',
      'cctControlOnUnsupportedHmds',
    ]) {
      expect(APP_SETTINGS).not.toHaveProperty(key);
    }
  });

  it('gives no headset settings when every global value is its default', async () => {
    const result = await runMigrations(
      { version: 2, tags: [], knownDevices: [hmd('LHR-TEST0001', 'Index', 'Valve')] } as Versioned,
      DEVICE_MANAGER_MIGRATION,
      {
        APP_SETTINGS: {
          version: 18,
          valveIndexMaxBrightness: 160,
          bigscreenBeyondMaxBrightness: 150,
          bigscreenBeyondUnsafeBrightness: false,
          hardwareBrightnessOnUnsupportedHmds: false,
          cctControlOnUnsupportedHmds: false,
        },
      }
    );

    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    expect((result.value as any).knownDevices[0]).not.toHaveProperty('settings');
  });
});

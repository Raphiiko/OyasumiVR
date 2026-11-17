import { describe, expect, it } from 'vitest';
import { runMigrations, Versioned } from 'src-shared-ts/src/migration-runner';
import { DEVICE_MANAGER_MIGRATION } from './device-manager.migrations';

describe('device manager migration 2 to 3', () => {
  it('fills the manufacturer of a known headset from its model, and keeps one already stored', async () => {
    const hmd = (id: string, typeName: string, manufacturer?: string) => ({
      id: `OVR_HMD_${id}`,
      typeName,
      manufacturer,
      deviceType: 'HMD',
    });

    const result = await runMigrations(
      {
        version: 2,
        tags: [],
        knownDevices: [
          hmd('LHR-TEST0001', 'Index'),
          hmd('BSB-TEST0002', 'Beyond'),
          hmd('FRM-TEST0003', 'Deckard MP'),
          hmd('PSV-TEST0004', 'PS VR2'),
          hmd('OTH-TEST0005', 'Visor X'),
          hmd('LHR-TEST0006', 'Index', 'Example'),
        ],
      } as Versioned,
      DEVICE_MANAGER_MIGRATION
    );

    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') return;
    const manufacturers = (result.value as any).knownDevices.map((d: any) => d.manufacturer);
    expect(manufacturers).toEqual(['Valve', 'Bigscreen', 'Valve', 'SIE', undefined, 'Example']);
  });
});

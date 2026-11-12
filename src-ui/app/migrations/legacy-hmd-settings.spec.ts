import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import type { DMKnownDevice } from '../models/device-manager';
import { copyLegacyHmdSettings } from './legacy-hmd-settings';

const hmd = (id: string, typeName: string, manufacturer?: string): DMKnownDevice => ({
  id,
  typeName,
  manufacturer,
  defaultName: id,
  deviceType: 'HMD',
  lastSeen: 0,
  tagIds: [],
  disabled: false,
});

const INDEX = hmd('OVR_HMD_LHR-TEST0001', 'Index', 'Valve');
const BEYOND = hmd('OVR_HMD_BSB-TEST0002', 'Beyond', 'Bigscreen');
const OTHER = hmd('OVR_HMD_OTH-TEST0003', 'Visor X', 'Example');

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({
  ...structuredClone(APP_SETTINGS_DEFAULT),
  legacyHmdSettings: {
    valveIndex: { maxBrightness: 130 },
    bigscreenBeyond: { maxBrightness: 120, unsafeBrightness: true },
    allHmds: { cctControlOnUnsupportedHmd: true },
  },
  ...patch,
});

describe('copyLegacyHmdSettings', () => {
  it("gives each known headset its model's values and the values for every headset", () => {
    expect(copyLegacyHmdSettings(settings(), [INDEX, BEYOND, OTHER])).toEqual({
      legacyHmdSettings: null,
      hmdSettings: {
        [INDEX.id]: { maxBrightness: 130, cctControlOnUnsupportedHmd: true },
        [BEYOND.id]: {
          maxBrightness: 120,
          unsafeBrightness: true,
          cctControlOnUnsupportedHmd: true,
        },
        [OTHER.id]: { cctControlOnUnsupportedHmd: true },
      },
    });
  });

  it("keeps a headset's own values", () => {
    const own = settings({ hmdSettings: { [INDEX.id]: { maxBrightness: 110 } } });
    expect(copyLegacyHmdSettings(own, [INDEX])?.hmdSettings[INDEX.id]).toEqual({
      maxBrightness: 110,
      cctControlOnUnsupportedHmd: true,
    });
  });

  it('matches a headset stored without its manufacturer by its model', () => {
    const index = { ...INDEX, manufacturer: undefined };
    const beyond = { ...BEYOND, manufacturer: undefined };
    const update = copyLegacyHmdSettings(settings(), [index, beyond]);
    expect(update?.hmdSettings[INDEX.id]?.maxBrightness).toBe(130);
    expect(update?.hmdSettings[BEYOND.id]?.maxBrightness).toBe(120);
  });

  it('waits until a headset is known, and does nothing without values to copy', () => {
    const controller = { ...INDEX, id: 'OVR_Controller_LHR-1', deviceType: 'CONTROLLER' as const };
    expect(copyLegacyHmdSettings(settings(), [controller])).toBeNull();
    expect(copyLegacyHmdSettings(settings({ legacyHmdSettings: null }), [INDEX])).toBeNull();
  });
});

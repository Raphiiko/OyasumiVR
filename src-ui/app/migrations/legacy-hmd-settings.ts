import type { AppSettings, HmdSettings, LegacyHmdSettings } from '../models/settings';
import type { DMKnownDevice } from '../models/device-manager';

/**
 * The migrated global headset values copied to each known headset, under its own values.
 * Null while there is nothing to copy or no headset is known yet.
 */
export function copyLegacyHmdSettings(
  settings: AppSettings,
  devices: DMKnownDevice[]
): Pick<AppSettings, 'hmdSettings' | 'legacyHmdSettings'> | null {
  const legacy = settings.legacyHmdSettings;
  const hmds = devices.filter((d) => d.deviceType === 'HMD');
  if (!legacy || hmds.length === 0) return null;
  const hmdSettings = { ...settings.hmdSettings };
  for (const hmd of hmds) {
    hmdSettings[hmd.id] = {
      ...legacy.allHmds,
      ...modelValues(legacy, hmd),
      ...hmdSettings[hmd.id],
    };
  }
  return { hmdSettings, legacyHmdSettings: null };
}

function modelValues(legacy: LegacyHmdSettings, hmd: DMKnownDevice): HmdSettings {
  // a headset not seen since the device manager started storing manufacturers has none
  const manufacturer = hmd.manufacturer;
  if (hmd.typeName === 'Index' && (manufacturer ?? 'Valve') === 'Valve') return legacy.valveIndex;
  if (manufacturer === 'Bigscreen' || (!manufacturer && hmd.typeName === 'Beyond')) {
    return legacy.bigscreenBeyond;
  }
  return {};
}

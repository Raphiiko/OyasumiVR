import type {
  DMDeviceSettings,
  DMDeviceSettingsModel,
  DMKnownDevice,
} from '../models/device-manager';

/** A known device's own settings, or undefined while it has none stored for this model. */
export function ownDeviceSettings<M extends DMDeviceSettingsModel>(
  device: DMKnownDevice | undefined,
  model: M
): Extract<DMDeviceSettings, { model: M }> | undefined {
  const settings = device?.settings;
  return settings?.model === model
    ? (settings as Extract<DMDeviceSettings, { model: M }>)
    : undefined;
}

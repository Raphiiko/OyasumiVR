import type { AppSettings, HmdSettings, HmdSettingsModel } from '../models/settings';

/** A headset's own values, or undefined while it has none stored for this model. */
export function ownHmdSettings<M extends HmdSettingsModel>(
  settings: AppSettings,
  id: string | null | undefined,
  model: M
): Extract<HmdSettings, { model: M }> | undefined {
  const own = id ? settings.hmdSettings[id] : undefined;
  return own?.model === model ? (own as Extract<HmdSettings, { model: M }>) : undefined;
}

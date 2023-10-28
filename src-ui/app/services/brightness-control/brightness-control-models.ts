export type SetBrightnessReason =
  | 'SLEEP_MODE_ENABLE'
  | 'SLEEP_MODE_DISABLE'
  | 'SLEEP_PREPARATION'
  | 'OYASUMIVR_START'
  | 'STEAMVR_START';

export interface SetBrightnessOptions {
  cancelActiveTransition: boolean;
  logReason: SetBrightnessReason | null;
}

export const SET_BRIGHTNESS_OPTIONS_DEFAULTS: SetBrightnessOptions = {
  cancelActiveTransition: true,
  logReason: null,
};

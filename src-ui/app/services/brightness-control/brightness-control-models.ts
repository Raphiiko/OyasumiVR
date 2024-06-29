export type SetBrightnessReason =
  | 'SLEEP_MODE_ENABLE'
  | 'SLEEP_MODE_DISABLE'
  | 'SLEEP_PREPARATION'
  | 'AT_SUNSET'
  | 'AT_SUNRISE';

export interface SetBrightnessOptions {
  cancelActiveTransition: boolean;
  logReason: SetBrightnessReason | null;
}

export const SET_BRIGHTNESS_OPTIONS_DEFAULTS: SetBrightnessOptions = {
  cancelActiveTransition: true,
  logReason: null,
};

export type SetBrightnessOrCCTReason =
  | 'SLEEP_MODE_ENABLE'
  | 'SLEEP_MODE_DISABLE'
  | 'SLEEP_PREPARATION'
  | 'AT_SUNSET'
  | 'AT_SUNRISE';

export interface SetBrightnessOrCCTOptions {
  cancelActiveTransition: boolean;
  logReason: SetBrightnessOrCCTReason | null;
}

export const SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS: SetBrightnessOrCCTOptions = {
  cancelActiveTransition: true,
  logReason: null,
};

export const OneTimeFlags = [
  'CCT_CONTROL_WARNING_DIALOG',
  'BASESTATION_COUNT_WARNING_DIALOG',
  'BRIGHTNESS_AUTOMATION_ON_HMD_CONNECT_EVENT_FEATURE',
] as const;

export type OneTimeFlag = (typeof OneTimeFlags)[number];

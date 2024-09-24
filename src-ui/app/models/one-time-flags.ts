export const OneTimeFlags = [
  'CCT_CONTROL_WARNING_DIALOG',
  'BASESTATION_COUNT_WARNING_DIALOG',
] as const;

export type OneTimeFlag = (typeof OneTimeFlags)[number];

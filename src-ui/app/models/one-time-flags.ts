export const OneTimeFlags = [
  'CCT_CONTROL_WARNING_DIALOG',
  'OSC_SCRIPT_SIMPLE_EDITOR_VRCHAT_AUTOCOMPLETE_INFO',
] as const;

export type OneTimeFlag = (typeof OneTimeFlags)[number];

import { TString } from './translatable-string';

export const OSC_SCRIPT_VERSION = 3;

export interface OscScript {
  version: typeof OSC_SCRIPT_VERSION;
  commands: OscScriptAction[];
}

export type OscScriptAction = OscScriptSleepAction | OscScriptCommandAction;

export type OscScriptSleepAction = {
  type: 'SLEEP';
  duration: number;
};

export type OscScriptCommandAction = {
  type: 'COMMAND';
  address: string;
  parameters: OscParameter[];
};

export type OscParameter = {
  type: OscParameterType;
  value: string;
};

export type OscParameterType = 'Int' | 'Float' | 'Boolean' | 'String';

export interface OscScriptCodeValidationError {
  line: number;
  message: TString;
}

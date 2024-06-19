import { TString } from './translatable-string';

export interface OscScript {
  version: 2;
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

export type OscParameterType = 'INT' | 'FLOAT' | 'BOOLEAN' | 'STRING';

export interface OscScriptCodeValidationError {
  line: number;
  message: TString;
}

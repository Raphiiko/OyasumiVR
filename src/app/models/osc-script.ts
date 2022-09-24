import { TString } from './translatable-string';
import { parseOscScriptFromCode } from '../utils/osc-script-utils';

export interface OscScript {
  version: 1;
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
  parameterType: OscParameterType;
  value: string;
};

export type OscParameterType = 'INT' | 'FLOAT' | 'BOOLEAN';

export interface OscScriptCodeValidationError {
  line: number;
  message: TString;
}

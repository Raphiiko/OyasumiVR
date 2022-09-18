export interface OscScript {
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

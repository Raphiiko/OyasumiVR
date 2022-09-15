export interface OscScript {
  commands: OscScriptAction[];
}

export type OscScriptAction = OscScriptSleepAction | OscScriptCommandAction;

export type OscScriptSleepAction = {
  type: 'sleep';
  duration: number;
};

export type OscScriptCommandAction = {
  type: 'command';
  address: string;
  parameterType: OscParameterType;
  value: string;
};

export type OscParameterType = 'INT' | 'FLOAT' | 'BOOLEAN';

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

export const SLEEPING_ANIMATION_OSC_SCRIPTS: {
  [key: string]: {
    SIDE_BACK?: OscScript;
    SIDE_FRONT?: OscScript;
    SIDE_LEFT?: OscScript;
    SIDE_RIGHT?: OscScript;
    FOOT_LOCK?: OscScript;
    FOOT_UNLOCK?: OscScript;
  };
} = {
  CUSTOM: {
    SIDE_BACK: undefined,
    SIDE_FRONT: undefined,
    SIDE_LEFT: undefined,
    SIDE_RIGHT: undefined,
    FOOT_LOCK: undefined,
    FOOT_UNLOCK: undefined,
  },
  'GOGO_LOCO_1.7.0': {
    SIDE_BACK: parseOscScriptFromCode(`
i 242 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
    `).script,
    SIDE_FRONT: parseOscScriptFromCode(`
i 240 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
    `).script,
    SIDE_LEFT: parseOscScriptFromCode(`
i 255 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
i 243 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
i 243 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
    `).script,
    SIDE_RIGHT: parseOscScriptFromCode(`
i 255 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
i 243 /avatar/parameters/VRCEmote
sleep 100ms
i 0 /avatar/parameters/VRCEmote
sleep 300ms
    `).script,
    FOOT_LOCK: parseOscScriptFromCode(`
b true /avatar/parameters/Go/Stationary
    `).script,
    FOOT_UNLOCK: parseOscScriptFromCode(`
b false /avatar/parameters/Go/Stationary
    `).script,
  },
  'MMM_SLEEP_SYSTEM_2.2': {
    SIDE_BACK: parseOscScriptFromCode(`
i 1 /avatar/parameters/VRCSupine
    `).script,
    SIDE_FRONT: parseOscScriptFromCode(`
i 0 /avatar/parameters/VRCSupine
    `).script,
    SIDE_LEFT: parseOscScriptFromCode(`
i 3 /avatar/parameters/VRCSupine
    `).script,
    SIDE_RIGHT: parseOscScriptFromCode(`
i 2 /avatar/parameters/VRCSupine
    `).script,
    FOOT_LOCK: parseOscScriptFromCode(`
b true /avatar/parameters/VRCFootAnchor
b true /avatar/parameters/VRCLockPose
    `).script,
    FOOT_UNLOCK: parseOscScriptFromCode(`
b false /avatar/parameters/VRCFootAnchor
b false /avatar/parameters/VRCLockPose
    `).script,
  },
};

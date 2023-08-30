import { OscScript } from './osc-script';
import { parseOscScriptFromCode } from '../utils/osc-script-utils';
import { TString } from './translatable-string';

export interface SleepingAnimationPresetNote {
  type: 'CAUTION' | 'WARNING' | 'INFO' | 'SUCCESS';
  text: TString;
}

export interface SleepingAnimationPresetInfoLink {
  label: TString;
  url: string;
}

export interface SleepingAnimationPreset {
  id: string;
  name: string;
  author: string;
  versions: string;
  infoLinks: SleepingAnimationPresetInfoLink[];
  oscScripts: {
    SIDE_BACK?: OscScript;
    SIDE_FRONT?: OscScript;
    SIDE_LEFT?: OscScript;
    SIDE_RIGHT?: OscScript;
    FOOT_LOCK?: OscScript;
    FOOT_UNLOCK?: OscScript;
  };
  notes?: SleepingAnimationPresetNote[];
}

const MMM_SLEEP_SYSTEM_2_2_PRESET: SleepingAnimationPreset = {
  id: 'MMM_SLEEP_SYSTEM_2_2',
  name: 'ごろ寝システム(EX)',
  versions: '2.2 - 2.3',
  author: 'みんみんみーん',
  infoLinks: [
    { label: 'ごろ寝システム (booth.pm)', url: 'https://booth.pm/ko/items/2886739' },
    { label: 'ごろ寝システムEX (booth.pm)', url: 'https://booth.pm/en/items/4233545' },
  ],
  oscScripts: {
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

const GOGO_LOCO_1_8_0_PRESET: SleepingAnimationPreset = {
  id: 'GOGO_LOCO_1_8_0',
  name: 'GoGo Loco',
  versions: '1.8.0+',
  author: 'franada',
  infoLinks: [{ label: 'GoGo Loco (booth.pm)', url: 'https://booth.pm/en/items/3290806' }],
  oscScripts: {
    SIDE_BACK: parseOscScriptFromCode(`
i 214 /avatar/parameters/Go/VRCEmote
f -1.0 /avatar/parameters/Go/Float
    `).script,
    SIDE_FRONT: parseOscScriptFromCode(`
i 214 /avatar/parameters/Go/RCEmote
f -0.75 /avatar/parameters/Go/Float
    `).script,
    SIDE_LEFT: parseOscScriptFromCode(`
i 214 /avatar/parameters/Go/VRCEmote
f -0.6 /avatar/parameters/Go/Float
    `).script,
    SIDE_RIGHT: parseOscScriptFromCode(`
i 214 /avatar/parameters/Go/VRCEmote
f -0.4 /avatar/parameters/Go/Float
    `).script,
    FOOT_LOCK: parseOscScriptFromCode(`
b true /avatar/parameters/Go/Stationary
    `).script,
    FOOT_UNLOCK: parseOscScriptFromCode(`
b false /avatar/parameters/Go/Stationary
    `).script,
  },
};

const GOGO_LOCO_LEGACY_1_7_1_PRESET: SleepingAnimationPreset = {
  id: 'GOGO_LOCO_1_7_1',
  name: 'GoGo Loco',
  versions: '1.7.1+',
  author: 'franada',
  infoLinks: [{ label: 'GoGo Loco (booth.pm)', url: 'https://booth.pm/en/items/3290806' }],
  oscScripts: {
    SIDE_BACK: parseOscScriptFromCode(`
i 214 /avatar/parameters/VRCEmote
f -1.0 /avatar/parameters/Go/Float
    `).script,
    SIDE_FRONT: parseOscScriptFromCode(`
i 214 /avatar/parameters/VRCEmote
f -0.75 /avatar/parameters/Go/Float
    `).script,
    SIDE_LEFT: parseOscScriptFromCode(`
i 214 /avatar/parameters/VRCEmote
f -0.6 /avatar/parameters/Go/Float
    `).script,
    SIDE_RIGHT: parseOscScriptFromCode(`
i 214 /avatar/parameters/VRCEmote
f -0.4 /avatar/parameters/Go/Float
    `).script,
    FOOT_LOCK: parseOscScriptFromCode(`
b true /avatar/parameters/Go/Stationary
    `).script,
    FOOT_UNLOCK: parseOscScriptFromCode(`
b false /avatar/parameters/Go/Stationary
    `).script,
  },
};

const GOGO_LOCO_LEGACY_PRESET: SleepingAnimationPreset = {
  id: 'GOGO_LOCO_LEGACY',
  name: 'GoGo Loco',
  versions: '1.6.2 - 1.7.0',
  author: 'franada',
  infoLinks: [{ label: 'GoGo Loco (booth.pm)', url: 'https://booth.pm/en/items/3290806' }],
  notes: [
    {
      type: 'WARNING',
      text: 'misc.GOGO_LOCO_LEGACY_PRESET_WARNING',
    },
  ],
  oscScripts: {
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
};

export const SLEEPING_ANIMATION_PRESETS: SleepingAnimationPreset[] = [
  MMM_SLEEP_SYSTEM_2_2_PRESET,
  GOGO_LOCO_1_8_0_PRESET,
  GOGO_LOCO_LEGACY_1_7_1_PRESET,
  GOGO_LOCO_LEGACY_PRESET,
];

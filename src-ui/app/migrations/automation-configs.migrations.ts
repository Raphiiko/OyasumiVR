import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import type { MigrationDefinition, Versioned } from 'src-shared-ts/src/migration-runner';
import { migrateOscScript } from './osc-script.migrations';
import { migrateKnownLighthouseDeviceId } from './lighthouse-device-id';
import { decryptStorageData, deserializeStorageCryptoKey } from './legacy/storage-crypto';
import {
  BRIGHTNESS_AUTOMATIONS_V17,
  DEVICE_POWER_AUTOMATIONS_V18,
  JOIN_NOTIFICATIONS_SOUNDS_V18,
  MSI_AFTERBURNER_V6,
  NIGHTMARE_DETECTION_SOUND_V18,
  SET_BRIGHTNESS_AUTOMATIONS_V9,
} from './automation-configs.historical-defaults';
import { normalizeWithDefaults } from './migration-defaults';

const RUN_AUTOMATION_COMMAND_FIELDS = [
  'onSleepModeEnableCommands',
  'onSleepModeDisableCommands',
  'onSleepPreparationCommands',
];

async function from19to20(data: any): Promise<any> {
  if (!data.RUN_AUTOMATIONS) {
    data.version = 20;
    return data;
  }
  const legacyKey = data.RUN_AUTOMATIONS.runAutomationsCryptoKey;
  delete data.RUN_AUTOMATIONS.runAutomationsCryptoKey;
  let key: CryptoKey | null = null;
  if (legacyKey) {
    key = await deserializeStorageCryptoKey(legacyKey);
  }
  for (const field of RUN_AUTOMATION_COMMAND_FIELDS) {
    const commands = data.RUN_AUTOMATIONS[field];
    if (!commands) continue;
    if (!key) throw new Error('No command key available');
    data.RUN_AUTOMATIONS[field] = await decryptStorageData(commands, key);
  }
  data.version = 20;
  return data;
}

function from18to19(data: any): any {
  data.version = 19;
  migrateSelectedDeviceIds(data);
  return data;
}

function migrateSelectedDeviceIds(value: any) {
  if (Array.isArray(value)) {
    value.forEach(migrateSelectedDeviceIds);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.devices)) {
    value.devices = [
      ...new Set(
        value.devices.map((id: string) => migrateKnownLighthouseDeviceId(id) ?? id) as string[]
      ),
    ];
  }
  Object.values(value).forEach(migrateSelectedDeviceIds);
}

export const AUTOMATION_CONFIGS_MIGRATION: MigrationDefinition<Versioned> = {
  targetVersion: AUTOMATION_CONFIGS_DEFAULT.version,
  minimumSupportedVersion: 2,
  steps: {
    2: from2to3,
    3: from3to4,
    4: from4to5,
    5: from5to6,
    6: from6to7,
    7: from7to8,
    8: from8to9,
    9: from9to10,
    10: from10to11,
    11: from11to12,
    12: from12to13,
    13: from13to14,
    14: from14to15,
    15: from15to16,
    16: from16to17,
    17: from17to18,
    18: from18to19,
    19: from19to20,
  },
  normalizeCurrentVersion: (data) => normalizeWithDefaults(AUTOMATION_CONFIGS_DEFAULT, data),
};

async function from17to18(data: any): Promise<any> {
  data.version = 18;
  if (data.JOIN_NOTIFICATIONS) {
    if (data.JOIN_NOTIFICATIONS.joinSound) {
      data.JOIN_NOTIFICATIONS.joinSoundMode = data.JOIN_NOTIFICATIONS.joinSound;
      data.JOIN_NOTIFICATIONS.joinSound = structuredClone(JOIN_NOTIFICATIONS_SOUNDS_V18.joinSound);
    }
    if (data.JOIN_NOTIFICATIONS.leaveSound) {
      data.JOIN_NOTIFICATIONS.leaveSoundMode = data.JOIN_NOTIFICATIONS.leaveSound;
      data.JOIN_NOTIFICATIONS.leaveSound = structuredClone(
        JOIN_NOTIFICATIONS_SOUNDS_V18.leaveSound
      );
    }
  }
  if (data.NIGHTMARE_DETECTION) {
    data.NIGHTMARE_DETECTION.sound = {
      ...structuredClone(NIGHTMARE_DETECTION_SOUND_V18),
      volume: data.NIGHTMARE_DETECTION.soundVolume,
      enabled: !!data.NIGHTMARE_DETECTION.playSound,
    };
    delete data.NIGHTMARE_DETECTION.playSound;
    delete data.NIGHTMARE_DETECTION.soundVolume;
  }

  if (data.OSC_GENERAL) {
    if (data.OSC_GENERAL.onSleepModeEnable) {
      data.OSC_GENERAL.onSleepModeEnable = await migrateOscScript(
        data.OSC_GENERAL.onSleepModeEnable
      );
    }
    if (data.OSC_GENERAL.onSleepModeDisable) {
      data.OSC_GENERAL.onSleepModeDisable = await migrateOscScript(
        data.OSC_GENERAL.onSleepModeDisable
      );
    }
    if (data.OSC_GENERAL.onSleepPreparation) {
      data.OSC_GENERAL.onSleepPreparation = await migrateOscScript(
        data.OSC_GENERAL.onSleepPreparation
      );
    }
  }
  if (data.SLEEPING_ANIMATIONS && Object.keys(data.SLEEPING_ANIMATIONS.oscScripts ?? {}).length) {
    for (const key of Object.keys(data.SLEEPING_ANIMATIONS.oscScripts)) {
      data.SLEEPING_ANIMATIONS.oscScripts[key] = await migrateOscScript(
        data.SLEEPING_ANIMATIONS.oscScripts[key]
      );
    }
  }

  const mapOVRDeviceClassToDMDeviceType = (ovrClass: string): string | null => {
    switch (ovrClass) {
      case 'HMD':
        return 'HMD';
      case 'Controller':
        return 'CONTROLLER';
      case 'GenericTracker':
        return 'TRACKER';
      case 'TrackingReference':
        return 'LIGHTHOUSE';
      default:
        return null;
    }
  };

  data.DEVICE_POWER_AUTOMATIONS = structuredClone(DEVICE_POWER_AUTOMATIONS_V18);

  if (
    data.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE?.enabled &&
    data.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE.deviceClasses?.length
  ) {
    const mappedTypes = data.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE.deviceClasses
      .map(mapOVRDeviceClassToDMDeviceType)
      .filter(Boolean);
    if (mappedTypes.length > 0) {
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesOnSleepModeEnable.types = mappedTypes;
    }
  }

  if (
    data.TURN_OFF_DEVICES_WHEN_CHARGING?.enabled &&
    data.TURN_OFF_DEVICES_WHEN_CHARGING.deviceClasses?.length
  ) {
    const mappedTypes = data.TURN_OFF_DEVICES_WHEN_CHARGING.deviceClasses
      .map(mapOVRDeviceClassToDMDeviceType)
      .filter(Boolean);
    if (mappedTypes.length > 0) {
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesWhenCharging.types = mappedTypes;
    }
  }

  if (data.TURN_OFF_DEVICES_ON_BATTERY_LEVEL?.enabled) {
    const batteryConfig = data.TURN_OFF_DEVICES_ON_BATTERY_LEVEL;
    const deviceTypes = [];

    if (batteryConfig.turnOffControllers) {
      deviceTypes.push('CONTROLLER');
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel_threshold =
        batteryConfig.turnOffControllersAtLevel;
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel_onlyWhileAsleep =
        batteryConfig.turnOffControllersOnlyDuringSleepMode;
    }

    if (batteryConfig.turnOffTrackers) {
      deviceTypes.push('TRACKER');
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel_threshold =
        batteryConfig.turnOffTrackersAtLevel;
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel_onlyWhileAsleep =
        batteryConfig.turnOffTrackersOnlyDuringSleepMode;
    }

    if (deviceTypes.length > 0) {
      data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel.types = deviceTypes;
    }
  }

  if (data.TURN_ON_LIGHTHOUSES_ON_OYASUMI_START?.enabled) {
    data.DEVICE_POWER_AUTOMATIONS.turnOnDevicesOnOyasumiStart.types.push('LIGHTHOUSE');
  }

  if (data.TURN_ON_LIGHTHOUSES_ON_STEAMVR_START?.enabled) {
    data.DEVICE_POWER_AUTOMATIONS.turnOnDevicesOnSteamVRStart.types.push('LIGHTHOUSE');
  }

  if (data.TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP?.enabled) {
    data.DEVICE_POWER_AUTOMATIONS.turnOffDevicesOnSteamVRStop.types.push('LIGHTHOUSE');
  }

  delete data.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE;
  delete data.TURN_OFF_DEVICES_WHEN_CHARGING;
  delete data.TURN_OFF_DEVICES_ON_BATTERY_LEVEL;
  delete data.TURN_ON_LIGHTHOUSES_ON_OYASUMI_START;
  delete data.TURN_ON_LIGHTHOUSES_ON_STEAMVR_START;
  delete data.TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP;

  if (data.SHUTDOWN_AUTOMATIONS) {
    data.SHUTDOWN_AUTOMATIONS.turnOffDevices = {
      devices: [],
      types: [],
      tagIds: [],
    };
    if (data.SHUTDOWN_AUTOMATIONS.turnOffControllers) {
      data.SHUTDOWN_AUTOMATIONS.turnOffDevices.types.push('CONTROLLER');
    }
    if (data.SHUTDOWN_AUTOMATIONS.turnOffTrackers) {
      data.SHUTDOWN_AUTOMATIONS.turnOffDevices.types.push('TRACKER');
    }
    if (data.SHUTDOWN_AUTOMATIONS.turnOffBaseStations) {
      data.SHUTDOWN_AUTOMATIONS.turnOffDevices.types.push('LIGHTHOUSE');
    }
    delete data.SHUTDOWN_AUTOMATIONS.turnOffControllers;
    delete data.SHUTDOWN_AUTOMATIONS.turnOffTrackers;
    delete data.SHUTDOWN_AUTOMATIONS.turnOffBaseStations;
  }

  return data;
}

function from16to17(data: any): any {
  data.version = 17;
  data.BRIGHTNESS_AUTOMATIONS = structuredClone(BRIGHTNESS_AUTOMATIONS_V17);
  data.BRIGHTNESS_AUTOMATIONS.advancedMode =
    data.BRIGHTNESS_CONTROL_ADVANCED_MODE?.enabled ?? false;
  data.BRIGHTNESS_AUTOMATIONS.enabled = true;
  data.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE = {
    enabled: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.enabled,
    changeBrightness: true,
    changeColorTemperature: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.enabled
      ? false
      : BRIGHTNESS_AUTOMATIONS_V17.SLEEP_MODE_ENABLE.changeColorTemperature,
    brightness: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.brightness,
    softwareBrightness: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.softwareBrightness,
    hardwareBrightness: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.hardwareBrightness,
    transition: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.transition,
    transitionTime: data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.transitionTime,
    colorTemperature: BRIGHTNESS_AUTOMATIONS_V17.SLEEP_MODE_ENABLE.colorTemperature,
  };
  data.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_DISABLE = {
    enabled: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.enabled,
    changeBrightness: true,
    changeColorTemperature: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.enabled
      ? false
      : BRIGHTNESS_AUTOMATIONS_V17.SLEEP_MODE_DISABLE.changeColorTemperature,
    brightness: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.brightness,
    softwareBrightness: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.softwareBrightness,
    hardwareBrightness: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.hardwareBrightness,
    transition: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transition,
    transitionTime: data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transitionTime,
    colorTemperature: BRIGHTNESS_AUTOMATIONS_V17.SLEEP_MODE_DISABLE.colorTemperature,
  };
  data.BRIGHTNESS_AUTOMATIONS.SLEEP_PREPARATION = {
    enabled: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.enabled,
    changeBrightness: true,
    changeColorTemperature: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.enabled
      ? false
      : BRIGHTNESS_AUTOMATIONS_V17.SLEEP_PREPARATION.changeColorTemperature,
    brightness: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.brightness,
    softwareBrightness: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.softwareBrightness,
    hardwareBrightness: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.hardwareBrightness,
    transition: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.transition,
    transitionTime: data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.transitionTime,
    colorTemperature: BRIGHTNESS_AUTOMATIONS_V17.SLEEP_PREPARATION.colorTemperature,
  };

  delete data.BRIGHTNESS_CONTROL_ADVANCED_MODE;
  delete data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  delete data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  delete data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION;
  return data;
}

function from15to16(data: any): any {
  data.version = 16;

  const oscAutomationsConfig = data.OSC_GENERAL;
  if (!oscAutomationsConfig) {
    return data;
  }

  const oscAutomations = [
    oscAutomationsConfig.onSleepModeEnable,
    oscAutomationsConfig.onSleepModeDisable,
    oscAutomationsConfig.onSleepPreparation,
    oscAutomationsConfig.SIDE_BACK,
    oscAutomationsConfig.SIDE_FRONT,
    oscAutomationsConfig.SIDE_LEFT,
    oscAutomationsConfig.SIDE_RIGHT,
    oscAutomationsConfig.FOOT_LOCK,
    oscAutomationsConfig.FOOT_UNLOCK,
  ];

  for (const automation of oscAutomations) {
    if (!automation) {
      continue;
    }

    automation.version = 2;
    automation.commands ??= [];

    for (const command of automation.commands) {
      if (command.type !== 'COMMAND') {
        continue;
      }

      command.parameters = [];
      command.parameters[0] = {};

      command.parameters[0]['type'] = command.parameterType;
      command.parameters[0]['value'] = command.value;

      delete command.parameterType;
      delete command.value;
    }
  }

  return data;
}

function from14to15(data: any): any {
  data.version = 15;
  if (data.SHUTDOWN_AUTOMATIONS) {
    const shutdownAutomations = data.SHUTDOWN_AUTOMATIONS;
    shutdownAutomations.triggerOnSleepDuration = shutdownAutomations.sleepDuration;
    delete shutdownAutomations.sleepDuration;
    shutdownAutomations.triggerOnSleepActivationWindow = shutdownAutomations.activationWindow;
    delete shutdownAutomations.activationWindow;
    shutdownAutomations.triggerOnSleepActivationWindowStart =
      shutdownAutomations.activationWindowStart;
    delete shutdownAutomations.activationWindowStart;
    shutdownAutomations.triggerOnSleepActivationWindowEnd = shutdownAutomations.activationWindowEnd;
    delete shutdownAutomations.activationWindowEnd;
  }
  return data;
}

function from13to14(data: any): any {
  data.version = 14;
  if (data.VRCHAT_MIC_MUTE_AUTOMATIONS) {
    delete data.VRCHAT_MIC_MUTE_AUTOMATIONS.mode;
  }
  return data;
}

function from12to13(data: any): any {
  data.version = 13;
  [
    'SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE',
    'SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE',
    'SET_BRIGHTNESS_ON_SLEEP_PREPARATION',
  ].forEach((automation) => {
    data[automation]['softwareBrightness'] = data[automation]['imageBrightness'];
    delete data[automation]['imageBrightness'];
    data[automation]['hardwareBrightness'] = data[automation]['displayBrightness'];
    delete data[automation]['displayBrightness'];
  });
  return data;
}

function from11to12(data: any): any {
  data.version = 12;
  if (data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE?.powerPolicy) {
    switch (data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy) {
      case 'HIGH_PERFORMANCE':
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy =
          '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
        break;
      case 'BALANCED':
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy =
          '381b4222-f694-41f0-9685-ff5bb260df2e';
        break;
      case 'POWER_SAVING':
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy =
          'a1841308-3541-4fab-bc81-f71556f20b4a';
        break;
      default:
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy = undefined;
        break;
    }
  }
  if (data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE?.powerPolicy) {
    switch (data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy) {
      case 'HIGH_PERFORMANCE':
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy =
          '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
        break;
      case 'BALANCED':
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy =
          '381b4222-f694-41f0-9685-ff5bb260df2e';
        break;
      case 'POWER_SAVING':
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy =
          'a1841308-3541-4fab-bc81-f71556f20b4a';
        break;
      default:
        data.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.powerPolicy = undefined;
        break;
    }
  }
  return data;
}

function from10to11(data: any): any {
  data.version = 11;
  if (data.SLEEPING_ANIMATIONS) {
    delete data.SLEEPING_ANIMATIONS.onlyIfAllTrackersTurnedOff;
  }
  return data;
}

function from9to10(data: any): any {
  data.version = 10;
  if (data.SHUTDOWN_AUTOMATIONS) {
    data.SHUTDOWN_AUTOMATIONS.powerDownWindows = data.SHUTDOWN_AUTOMATIONS.shutdownWindows;
    data.SHUTDOWN_AUTOMATIONS.powerDownWindowsMode = 'SHUTDOWN';
    delete data.SHUTDOWN_AUTOMATIONS.shutdownWindows;
  }
  return data;
}

function from8to9(data: any): any {
  data.version = 9;
  const displayBrightnessOnEnableConfig = data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  const displayBrightnessOnDisableConfig = data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  const imageBrightnessOnEnableConfig = data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  const imageBrightnessOnDisableConfig = data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  delete data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  delete data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  delete data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  delete data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE = structuredClone(
    SET_BRIGHTNESS_AUTOMATIONS_V9.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
  );
  data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE = structuredClone(
    SET_BRIGHTNESS_AUTOMATIONS_V9.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
  );
  data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION = structuredClone(
    SET_BRIGHTNESS_AUTOMATIONS_V9.SET_BRIGHTNESS_ON_SLEEP_PREPARATION
  );
  if (displayBrightnessOnEnableConfig?.enabled) {
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.enabled = true;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.brightness =
      displayBrightnessOnEnableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.imageBrightness = 100;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.displayBrightness =
      displayBrightnessOnEnableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.transition =
      displayBrightnessOnEnableConfig.transition;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.transitionTime =
      displayBrightnessOnEnableConfig.transitionTime;
  } else if (imageBrightnessOnEnableConfig?.enabled) {
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.enabled = true;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.brightness = imageBrightnessOnEnableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.imageBrightness =
      imageBrightnessOnEnableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.displayBrightness = 100;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.transition = imageBrightnessOnEnableConfig.transition;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.transitionTime =
      imageBrightnessOnEnableConfig.transitionTime;
  }
  if (displayBrightnessOnDisableConfig?.enabled) {
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.enabled = true;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.brightness =
      displayBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.imageBrightness = 100;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.displayBrightness =
      displayBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transition =
      displayBrightnessOnDisableConfig.transition;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transitionTime =
      displayBrightnessOnDisableConfig.transitionTime;
  } else if (imageBrightnessOnDisableConfig?.enabled) {
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.enabled = true;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.brightness =
      imageBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.imageBrightness =
      imageBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.displayBrightness = 100;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transition =
      imageBrightnessOnDisableConfig.transition;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transitionTime =
      imageBrightnessOnDisableConfig.transitionTime;
  }
  return data;
}

function from7to8(data: any): any {
  data.version = 8;
  return data;
}

function from6to7(data: any): any {
  data.version = 7;
  return data;
}

function from5to6(data: any): any {
  data.version = 6;
  data.MSI_AFTERBURNER = structuredClone(MSI_AFTERBURNER_V6);
  data.MSI_AFTERBURNER.enabled = data.GPU_POWER_LIMITS?.enabled ?? false;
  return data;
}

function from4to5(data: any): any {
  data.version = 5;
  return data;
}

function from3to4(data: any): any {
  data.version = 4;
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  return data;
}

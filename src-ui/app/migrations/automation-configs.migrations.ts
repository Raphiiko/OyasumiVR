import { cloneDeep, mergeWith } from 'lodash';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../models/automations';
import { info } from 'tauri-plugin-log-api';

const migrations: { [v: number]: (data: any) => any } = {
  1: resetToLatest,
  2: resetToLatest,
  3: from2to3,
  4: from3to4,
  5: from4to5,
  6: from5to6,
  7: from6to7,
  8: from7to8,
  9: from8to9,
  10: from9to10,
  11: from10to11,
  12: from11to12,
  13: from12to13,
  14: from13to14,
};

export function migrateAutomationConfigs(data: any): AutomationConfigs {
  let currentVersion = data.version || 0;
  // Reset to latest when the current version is higher than the latest
  if (currentVersion > AUTOMATION_CONFIGS_DEFAULT.version) {
    data = resetToLatest(data);
    info(
      `[automation-configs-migrations] Reset future automation configs version back to version ${
        currentVersion + ''
      }`
    );
  }
  while (currentVersion < AUTOMATION_CONFIGS_DEFAULT.version) {
    data = migrations[++currentVersion](cloneDeep(data));
    currentVersion = data.version;
    info(
      `[automation-configs-migrations] Migrated automation configs to version ${
        currentVersion + ''
      }`
    );
  }
  data = mergeWith(cloneDeep(AUTOMATION_CONFIGS_DEFAULT), data, (objValue, srcValue) => {
    if (Array.isArray(objValue)) {
      return srcValue;
    }
  });
  return data as AutomationConfigs;
}

function resetToLatest(data: any): any {
  // Reset to latest
  data = cloneDeep(AUTOMATION_CONFIGS_DEFAULT);
  return data;
}

function from13to14(data: any): any {
  data.version = 14;
  delete data['VRCHAT_MIC_MUTE_AUTOMATIONS'].mode;
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
  // Reference old configuration
  const displayBrightnessOnEnableConfig = data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  const displayBrightnessOnDisableConfig = data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  const imageBrightnessOnEnableConfig = data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  const imageBrightnessOnDisableConfig = data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  // Delete old configuration
  delete data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  delete data.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  delete data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
  delete data.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
  // Insert new configuration defaults
  data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
  );
  data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
  );
  data.SET_BRIGHTNESS_ON_SLEEP_PREPARATION = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SET_BRIGHTNESS_ON_SLEEP_PREPARATION
  );
  // Attempt to migrate old on sleep enable automations
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
  // Attempt to migrate old on sleep disable automations
  if (displayBrightnessOnDisableConfig?.enabled) {
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.enabled = true;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.brightness =
      displayBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.imageBrightness = 100;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.displayBrightness =
      displayBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transition =
      displayBrightnessOnDisableConfig.transition;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transitionTime =
      displayBrightnessOnDisableConfig.transitionTime;
  } else if (imageBrightnessOnDisableConfig?.enabled) {
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.enabled = true;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.brightness =
      imageBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.imageBrightness =
      imageBrightnessOnDisableConfig.brightness;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.displayBrightness = 100;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transition =
      imageBrightnessOnDisableConfig.transition;
    data.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.transitionTime =
      imageBrightnessOnDisableConfig.transitionTime;
  }
  return data;
}

function from7to8(data: any): any {
  data.version = 8;
  // Missing keys are now always added by default
  return data;
}

function from6to7(data: any): any {
  data.version = 7;
  // Missing keys are now always added by default
  return data;
}

function from5to6(data: any): any {
  data.version = 6;
  data.MSI_AFTERBURNER = cloneDeep(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER);
  data.MSI_AFTERBURNER.enabled = data.GPU_POWER_LIMITS.enabled;
  return data;
}

function from4to5(data: any): any {
  data.version = 5;
  // Missing keys are now always added by default
  return data;
}

function from3to4(data: any): any {
  data.version = 4;
  // Missing keys are now always added by default
  return data;
}

function from2to3(data: any): any {
  data.version = 3;
  // Missing keys are now always added by default
  return data;
}

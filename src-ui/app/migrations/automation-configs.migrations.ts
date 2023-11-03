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

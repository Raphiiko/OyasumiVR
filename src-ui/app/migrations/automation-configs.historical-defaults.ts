export const MSI_AFTERBURNER_V6 = {
  enabled: false,
  msiAfterburnerPath: 'C:\\Program Files (x86)\\MSI Afterburner\\MSIAfterburner.exe',
  onSleepEnableProfile: 0,
  onSleepDisableProfile: 0,
};

export const SET_BRIGHTNESS_AUTOMATIONS_V9 = {
  SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
    brightness: 20,
    imageBrightness: 20,
    displayBrightness: 100,
    transition: true,
    transitionTime: 1000 * 60 * 5,
    applyOnStart: true,
  },
  SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
    brightness: 100,
    imageBrightness: 100,
    displayBrightness: 100,
    transition: true,
    transitionTime: 10000,
    applyOnStart: true,
  },
  SET_BRIGHTNESS_ON_SLEEP_PREPARATION: {
    enabled: false,
    brightness: 50,
    imageBrightness: 50,
    displayBrightness: 100,
    transition: true,
    transitionTime: 30000,
  },
};

export const BRIGHTNESS_AUTOMATIONS_V17 = {
  enabled: true,
  advancedMode: false,
  SLEEP_PREPARATION: {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 50,
    softwareBrightness: 50,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 1000 * 60 * 5,
    colorTemperature: 3500,
  },
  SLEEP_MODE_ENABLE: {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 20,
    softwareBrightness: 20,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 10000,
    colorTemperature: 1800,
  },
  SLEEP_MODE_DISABLE: {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 100,
    softwareBrightness: 100,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 10000,
    colorTemperature: 6600,
  },
  AT_SUNSET: {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 80,
    softwareBrightness: 80,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 1000 * 60 * 5,
    colorTemperature: 1800,
  },
  AT_SUNRISE: {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 100,
    softwareBrightness: 100,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 1000 * 60 * 5,
    colorTemperature: 6600,
  },
};

export const JOIN_NOTIFICATIONS_SOUNDS_V18 = {
  joinSound: {
    sound: {
      id: 'ripple',
      type: 'BUILT_IN',
      duration: 3.6,
      name: 'Ripple',
      userConfigurable: true,
    },
    volume: 100,
    enabled: true,
  },
  leaveSound: {
    sound: {
      id: 'pulse',
      type: 'BUILT_IN',
      duration: 1.1,
      name: 'Pulse',
      userConfigurable: true,
    },
    volume: 100,
    enabled: true,
  },
};

export const NIGHTMARE_DETECTION_SOUND_V18 = {
  sound: {
    id: 'ripple',
    type: 'BUILT_IN',
    duration: 3.6,
    name: 'Ripple',
    userConfigurable: true,
  },
  volume: 100,
  enabled: true,
};

const deviceSelection = () => ({
  devices: [] as string[],
  types: [] as string[],
  tagIds: [] as string[],
});

export const DEVICE_POWER_AUTOMATIONS_V18 = {
  enabled: true,
  turnOffDevicesOnSleepModeEnable: deviceSelection(),
  turnOffDevicesOnSleepModeDisable: deviceSelection(),
  turnOffDevicesOnSleepPreparation: deviceSelection(),
  turnOffDevicesWhenCharging: deviceSelection(),
  turnOffDevicesBelowBatteryLevel: deviceSelection(),
  turnOffDevicesBelowBatteryLevel_threshold: 50,
  turnOffDevicesBelowBatteryLevel_onlyWhileAsleep: false,
  turnOffDevicesOnSteamVRStop: deviceSelection(),
  turnOnDevicesOnSteamVRStart: deviceSelection(),
  turnOnDevicesOnOyasumiStart: deviceSelection(),
  turnOnDevicesOnSleepModeDisable: deviceSelection(),
};

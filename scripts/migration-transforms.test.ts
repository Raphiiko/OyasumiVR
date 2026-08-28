// run from the repo root: node --test scripts/migration-transforms.test.ts
import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

// Node's type stripping cannot tell type-only named imports from value imports,
// so named imports in app sources become namespace imports plus destructuring.
// The Tauri plugins and the one Angular service in the import chain load from stubs.
const STUB_SOURCES: Record<string, string> = {
  'stub:@tauri-apps/plugin-log':
    'export const info = async () => {};\nexport const error = async () => {};\n',
  'stub:@tauri-apps/plugin-dialog': 'export const message = async () => {};\n',
  'stub:@tauri-apps/plugin-fs':
    'export const BaseDirectory = { AppData: 18 };\nexport const writeTextFile = async () => {};\n',
  'stub:app/frame-limiter.service':
    "export const FrameLimiterPresets = [{ appId: 438100, appLabel: 'VRChat', appIcon: 'assets/img/vrc_icon.png' }];\n",
};

let importCounter = 0;

registerHooks({
  resolve(specifier: string, context: any, nextResolve: any) {
    if (specifier.startsWith('src-shared-ts/')) {
      return { url: new URL(`../${specifier}.ts`, import.meta.url).href, shortCircuit: true };
    }
    if (specifier.startsWith('@tauri-apps/')) {
      return { url: 'stub:' + specifier, shortCircuit: true };
    }
    if (specifier.endsWith('frame-limiter.service')) {
      return { url: 'stub:app/frame-limiter.service', shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(specifier + '.ts', context);
      }
      throw err;
    }
  },
  load(url: string, context: any, nextLoad: any) {
    const stubSource = STUB_SOURCES[url];
    if (stubSource !== undefined)
      return { format: 'module', source: stubSource, shortCircuit: true };
    const result = nextLoad(url, context);
    if (!url.includes('/src-ui/') || !url.endsWith('.ts')) return result;
    const source = String(result.source).replace(
      /import\s*\{([^}]*)\}\s*from\s*(["'][^"']+["']);?/g,
      (_m: string, bindings: string, quoted: string) => {
        const ns = `__imp${importCounter}`;
        importCounter++;
        return `import * as ${ns} from ${quoted}; const { ${bindings.trim()} } = ${ns}.default ?? ${ns};`;
      }
    );
    return { ...result, source };
  },
});

const loadMigrations = async () => {
  const [{ AUTOMATION_CONFIGS_MIGRATION }, { runMigrations }] = await Promise.all([
    import('../src-ui/app/migrations/automation-configs.migrations'),
    import('../src-shared-ts/src/migration-runner'),
  ]);
  return {
    migrateAutomationConfigs: async (data: any) => {
      const result = await runMigrations(data, AUTOMATION_CONFIGS_MIGRATION);
      if (result.status !== 'migrated' && result.status !== 'unchanged') {
        throw new Error(`Migration failed with status ${result.status}`);
      }
      return result.value;
    },
  };
};

const RIPPLE_SOUND = {
  id: 'ripple',
  type: 'BUILT_IN',
  duration: 3.6,
  name: 'Ripple',
  userConfigurable: true,
};
const PULSE_SOUND = {
  id: 'pulse',
  type: 'BUILT_IN',
  duration: 1.1,
  name: 'Pulse',
  userConfigurable: true,
};

test('current automation data with an invalid shape is rejected', async () => {
  const { migrateAutomationConfigs } = await loadMigrations();
  await assert.rejects(() => migrateAutomationConfigs({ version: 20, BRIGHTNESS_AUTOMATIONS: [] }));
});

test('v8: brightness construction separates enable and disable, shutdown renames nest', async () => {
  const { migrateAutomationConfigs } = await loadMigrations();
  const result = await migrateAutomationConfigs({
    version: 8,
    GPU_POWER_LIMITS: {
      enabled: true,
      selectedDeviceId: null,
      onSleepEnable: { enabled: false, resetToDefault: false },
      onSleepDisable: { enabled: false, resetToDefault: true },
    },
    TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE: { enabled: true, deviceClasses: ['HMD', 'Controller'] },
    MSI_AFTERBURNER: {
      enabled: true,
      msiAfterburnerPath: 'C:\\Sentinel\\MSIAfterburner.exe',
      onSleepEnableProfile: 2,
      onSleepDisableProfile: 3,
    },
    DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE: {
      enabled: true,
      brightness: 37,
      transition: false,
      transitionTime: 4242,
    },
    IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE: {
      enabled: true,
      brightness: 41,
      transition: true,
      transitionTime: 9000,
    },
    SHUTDOWN_AUTOMATIONS: {
      enabled: true,
      triggerOnSleep: false,
      sleepDuration: 777000,
      activationWindow: true,
      activationWindowStart: [21, 42],
      activationWindowEnd: [8, 15],
      quitSteamVR: false,
      turnOffControllers: true,
      turnOffTrackers: false,
      turnOffBaseStations: false,
      shutdownWindows: true,
    },
    WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE: { enabled: true, powerPolicy: 'BALANCED' },
  });

  assert.equal(result.version, 20);
  assert.deepEqual(result.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE, {
    enabled: true,
    changeBrightness: true,
    changeColorTemperature: false,
    brightness: 37,
    softwareBrightness: 100,
    hardwareBrightness: 37,
    transition: false,
    transitionTime: 4242,
    colorTemperature: 1800,
  });
  assert.deepEqual(result.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_DISABLE, {
    enabled: true,
    changeBrightness: true,
    changeColorTemperature: false,
    brightness: 41,
    softwareBrightness: 41,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 9000,
    colorTemperature: 6600,
  });
  assert.equal(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepDuration, 777000);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindow, true);
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindowStart, [21, 42]);
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindowEnd, [8, 15]);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.powerDownWindows, true);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.powerDownWindowsMode, 'SHUTDOWN');
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.turnOffDevices.types, ['CONTROLLER']);
  assert.equal(
    result.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.powerPolicy,
    '381b4222-f694-41f0-9685-ff5bb260df2e'
  );
  assert.deepEqual(result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesOnSleepModeEnable.types, [
    'HMD',
    'CONTROLLER',
  ]);
  assert.equal(result.MSI_AFTERBURNER.enabled, true);
});

test('v14: shutdown trigger fields rename inside SHUTDOWN_AUTOMATIONS, sounds freeze at v18 defaults', async () => {
  const { migrateAutomationConfigs } = await loadMigrations();
  const result = await migrateAutomationConfigs({
    version: 14,
    BRIGHTNESS_CONTROL_ADVANCED_MODE: { enabled: false },
    SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE: {
      enabled: false,
      brightness: 20,
      softwareBrightness: 20,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 300000,
      applyOnStart: false,
    },
    SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE: {
      enabled: false,
      brightness: 100,
      softwareBrightness: 100,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      applyOnStart: false,
    },
    SET_BRIGHTNESS_ON_SLEEP_PREPARATION: {
      enabled: false,
      brightness: 50,
      softwareBrightness: 50,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 30000,
    },
    VRCHAT_MIC_MUTE_AUTOMATIONS: {
      enabled: true,
      onSleepModeEnable: 'MUTE',
      onSleepModeDisable: 'NONE',
      onSleepPreparation: 'NONE',
    },
    JOIN_NOTIFICATIONS: {
      enabled: true,
      playerIds: ['usr_1'],
      onlyDuringSleepMode: false,
      onlyWhenPreviouslyAlone: false,
      onlyWhenLeftAlone: false,
      joinNotification: 'WHITELIST',
      leaveNotification: 'DISABLED',
      joinSound: 'FRIEND',
      leaveSound: 'BLACKLIST',
      joinSoundVolume: 33,
    },
    NIGHTMARE_DETECTION: {
      enabled: true,
      heartRateThreshold: 130,
      periodDuration: 60000,
      disableSleepMode: false,
      playSound: true,
      soundVolume: 55,
    },
    TURN_OFF_DEVICES_ON_BATTERY_LEVEL: {
      enabled: true,
      turnOffControllers: true,
      turnOffControllersAtLevel: 22,
      turnOffControllersOnlyDuringSleepMode: true,
      turnOffTrackers: true,
      turnOffTrackersAtLevel: 33,
      turnOffTrackersOnlyDuringSleepMode: false,
    },
    SHUTDOWN_AUTOMATIONS: {
      enabled: true,
      triggerOnSleep: false,
      sleepDuration: 777000,
      activationWindow: true,
      activationWindowStart: [21, 42],
      activationWindowEnd: [8, 15],
      quitSteamVR: true,
      turnOffControllers: false,
      turnOffTrackers: false,
      turnOffBaseStations: false,
      powerDownWindows: false,
      powerDownWindowsMode: 'REBOOT',
    },
  });

  assert.equal(result.version, 20);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepDuration, 777000);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindow, true);
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindowStart, [21, 42]);
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindowEnd, [8, 15]);
  assert.equal('sleepDuration' in result.SHUTDOWN_AUTOMATIONS, false);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.powerDownWindowsMode, 'REBOOT');
  assert.equal('mode' in result.VRCHAT_MIC_MUTE_AUTOMATIONS, false);
  assert.equal(result.VRCHAT_MIC_MUTE_AUTOMATIONS.onSleepModeEnable, 'MUTE');
  assert.equal(result.JOIN_NOTIFICATIONS.joinSoundMode, 'FRIEND');
  assert.equal(result.JOIN_NOTIFICATIONS.leaveSoundMode, 'BLACKLIST');
  assert.deepEqual(result.JOIN_NOTIFICATIONS.joinSound, {
    sound: RIPPLE_SOUND,
    volume: 100,
    enabled: true,
  });
  assert.deepEqual(result.JOIN_NOTIFICATIONS.leaveSound, {
    sound: PULSE_SOUND,
    volume: 100,
    enabled: true,
  });
  assert.deepEqual(result.NIGHTMARE_DETECTION.sound, {
    sound: RIPPLE_SOUND,
    volume: 55,
    enabled: true,
  });
  assert.equal('playSound' in result.NIGHTMARE_DETECTION, false);
  assert.deepEqual(result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel.types, [
    'CONTROLLER',
    'TRACKER',
  ]);
  assert.equal(result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel_threshold, 33);
  assert.equal(
    result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesBelowBatteryLevel_onlyWhileAsleep,
    false
  );
});

test('v16: brightness automations build from the frozen v17 defaults', async () => {
  const { migrateAutomationConfigs } = await loadMigrations();
  const result = await migrateAutomationConfigs({
    version: 16,
    BRIGHTNESS_CONTROL_ADVANCED_MODE: { enabled: false },
    SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE: {
      enabled: true,
      brightness: 63,
      softwareBrightness: 29,
      hardwareBrightness: 61,
      transition: true,
      transitionTime: 9000,
      applyOnStart: false,
    },
    SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE: {
      enabled: false,
      brightness: 100,
      softwareBrightness: 100,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      applyOnStart: false,
    },
    SET_BRIGHTNESS_ON_SLEEP_PREPARATION: {
      enabled: true,
      brightness: 51,
      softwareBrightness: 52,
      hardwareBrightness: 53,
      transition: false,
      transitionTime: 77000,
    },
  });

  assert.equal(result.version, 20);
  assert.equal(result.BRIGHTNESS_AUTOMATIONS.advancedMode, false);
  assert.deepEqual(result.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE, {
    enabled: true,
    changeBrightness: true,
    changeColorTemperature: false,
    brightness: 63,
    softwareBrightness: 29,
    hardwareBrightness: 61,
    transition: true,
    transitionTime: 9000,
    colorTemperature: 1800,
  });
  assert.deepEqual(result.BRIGHTNESS_AUTOMATIONS.SLEEP_PREPARATION, {
    enabled: true,
    changeBrightness: true,
    changeColorTemperature: false,
    brightness: 51,
    softwareBrightness: 52,
    hardwareBrightness: 53,
    transition: false,
    transitionTime: 77000,
    colorTemperature: 3500,
  });
  assert.deepEqual(result.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_DISABLE, {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 100,
    softwareBrightness: 100,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 10000,
    colorTemperature: 6600,
  });
  assert.equal(result.BRIGHTNESS_AUTOMATIONS.AT_SUNSET.transitionTime, 300000);
  assert.equal(result.BRIGHTNESS_AUTOMATIONS.AT_SUNSET.type, 'SUN');
});

test('v17: notification and device power automations freeze at v18 defaults', async () => {
  const { migrateAutomationConfigs } = await loadMigrations();
  const result = await migrateAutomationConfigs({
    version: 17,
    BRIGHTNESS_AUTOMATIONS: {
      enabled: true,
      advancedMode: true,
      SLEEP_MODE_ENABLE: {
        enabled: true,
        changeBrightness: true,
        changeColorTemperature: true,
        brightness: 17,
        softwareBrightness: 18,
        hardwareBrightness: 19,
        transition: true,
        transitionTime: 31000,
        colorTemperature: 1900,
      },
    },
    JOIN_NOTIFICATIONS: {
      enabled: true,
      playerIds: [],
      onlyDuringSleepMode: false,
      onlyWhenPreviouslyAlone: false,
      onlyWhenLeftAlone: false,
      joinNotification: 'WHITELIST',
      leaveNotification: 'DISABLED',
      joinSound: 'FRIEND',
      leaveSound: 'BLACKLIST',
      joinSoundVolume: 100,
    },
    NIGHTMARE_DETECTION: {
      enabled: true,
      heartRateThreshold: 130,
      periodDuration: 60000,
      disableSleepMode: false,
      playSound: true,
      soundVolume: 55,
    },
    SHUTDOWN_AUTOMATIONS: {
      enabled: true,
      triggersEnabled: true,
      triggerOnSleep: false,
      triggerOnSleepDuration: 900000,
      triggerOnSleepActivationWindow: false,
      triggerOnSleepActivationWindowStart: [23, 0],
      triggerOnSleepActivationWindowEnd: [7, 0],
      triggerWhenAlone: true,
      triggerWhenAloneDuration: 123000,
      triggerWhenAloneOnlyWhenSleepModeActive: true,
      triggerWhenAloneActivationWindow: false,
      triggerWhenAloneActivationWindowStart: [23, 0],
      triggerWhenAloneActivationWindowEnd: [7, 0],
      quitSteamVR: true,
      turnOffControllers: true,
      turnOffTrackers: true,
      turnOffBaseStations: false,
      powerDownWindows: true,
      powerDownWindowsMode: 'SHUTDOWN',
    },
    TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE: { enabled: true, deviceClasses: ['HMD'] },
    TURN_OFF_DEVICES_WHEN_CHARGING: { enabled: false, deviceClasses: ['GenericTracker'] },
  });

  assert.equal(result.version, 20);
  assert.equal(result.BRIGHTNESS_AUTOMATIONS.advancedMode, true);
  assert.equal(result.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE.brightness, 17);
  assert.equal(result.JOIN_NOTIFICATIONS.joinSoundMode, 'FRIEND');
  assert.equal(result.JOIN_NOTIFICATIONS.leaveSoundMode, 'BLACKLIST');
  assert.deepEqual(result.JOIN_NOTIFICATIONS.joinSound, {
    sound: RIPPLE_SOUND,
    volume: 100,
    enabled: true,
  });
  assert.deepEqual(result.JOIN_NOTIFICATIONS.leaveSound, {
    sound: PULSE_SOUND,
    volume: 100,
    enabled: true,
  });
  assert.deepEqual(result.NIGHTMARE_DETECTION.sound, {
    sound: RIPPLE_SOUND,
    volume: 55,
    enabled: true,
  });
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.turnOffDevices.types, ['CONTROLLER', 'TRACKER']);
  assert.deepEqual(result.SHUTDOWN_AUTOMATIONS.turnOffDevices.devices, []);
  assert.deepEqual(result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesOnSleepModeEnable.types, ['HMD']);
  assert.deepEqual(result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesWhenCharging.types, []);
  assert.equal(result.SHUTDOWN_AUTOMATIONS.triggerWhenAloneDuration, 123000);
});

test('v2: oldest automation schema migrates end to end through the frozen defaults', async () => {
  const { migrateAutomationConfigs } = await loadMigrations();
  const result = await migrateAutomationConfigs({
    version: 2,
    GPU_POWER_LIMITS: {
      enabled: true,
      selectedDeviceId: null,
      onSleepEnable: { enabled: false, resetToDefault: false },
      onSleepDisable: { enabled: false, resetToDefault: true },
    },
    SLEEP_MODE_ENABLE_AT_TIME: { enabled: true, time: '23:42' },
    TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE: { enabled: true, deviceClasses: ['HMD'] },
  });

  assert.equal(result.version, 20);
  assert.equal(result.SLEEP_MODE_ENABLE_AT_TIME.time, '23:42');
  assert.deepEqual(result.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE, {
    enabled: false,
    changeBrightness: true,
    changeColorTemperature: true,
    brightness: 20,
    softwareBrightness: 20,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 300000,
    colorTemperature: 1800,
  });
  assert.deepEqual(result.DEVICE_POWER_AUTOMATIONS.turnOffDevicesOnSleepModeEnable.types, ['HMD']);
  assert.equal(result.MSI_AFTERBURNER.enabled, true);
});

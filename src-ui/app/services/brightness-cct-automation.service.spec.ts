import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationConfigService } from './automation-config.service';
import type { SleepService } from './sleep.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  type BrightnessAutomationsConfig,
  type BrightnessEvent,
} from '../models/automations';
import { BrightnessCctAutomationService } from './brightness-cct-automation.service';

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ['07:00', '19:00']),
}));

type Overrides = Partial<BrightnessAutomationsConfig>;

function buildConfig(overrides: Overrides = {}): BrightnessAutomationsConfig {
  const config = structuredClone(AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS);
  config.AT_SUNSET.enabled = true;
  config.AT_SUNSET.activationTime = '19:00';
  config.AT_SUNRISE.enabled = true;
  config.AT_SUNRISE.activationTime = '07:00';
  return Object.assign(config, structuredClone(overrides));
}

function createService(config: BrightnessAutomationsConfig, sleepMode: boolean) {
  const configs = new BehaviorSubject({ BRIGHTNESS_AUTOMATIONS: config });
  // the selection reads only the config and sleep observables; the control services stay unused
  const unused = {} as never;
  return new BrightnessCctAutomationService(
    { configs: configs.asObservable() } as unknown as AutomationConfigService,
    { mode: new BehaviorSubject(sleepMode).asObservable() } as unknown as SleepService,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused
  );
}

async function decideAt(
  config: BrightnessAutomationsConfig,
  sleepMode: boolean,
  hour: number
): Promise<{ brightness?: BrightnessEvent; cct?: BrightnessEvent }> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 15, hour, 0, 0));
  try {
    const result = await createService(config, sleepMode).determineHmdConnectAutomations();
    return { brightness: result.brightnessAutomation, cct: result.cctAutomation };
  } finally {
    vi.useRealTimers();
  }
}

const sleepEnableOn = {
  SLEEP_MODE_ENABLE: {
    ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE,
    enabled: true,
  },
} satisfies Overrides;

const sleepDisableOn = {
  SLEEP_MODE_DISABLE: {
    ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_DISABLE,
    enabled: true,
  },
} satisfies Overrides;

const SUNSET_HOUR = 20;
const SUNRISE_HOUR = 8;

interface Case {
  name: string;
  overrides: Overrides;
  sleepMode: boolean;
  hour: number;
  brightness?: BrightnessEvent;
  cct?: BrightnessEvent;
}

const cases: Case[] = [
  {
    name: 'excludes a guarded sunset while sleep mode is on, on both channels',
    overrides: sleepEnableOn,
    sleepMode: true,
    hour: SUNSET_HOUR,
    brightness: 'SLEEP_MODE_ENABLE',
    cct: 'SLEEP_MODE_ENABLE',
  },
  {
    name: 'keeps a guarded sunset while sleep mode is off',
    overrides: sleepDisableOn,
    sleepMode: false,
    hour: SUNSET_HOUR,
    brightness: 'AT_SUNSET',
    cct: 'AT_SUNSET',
  },
  {
    name: 'keeps an unguarded sunset while sleep mode is on',
    overrides: {
      ...sleepEnableOn,
      AT_SUNSET: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNSET,
        enabled: true,
        activationTime: '19:00',
        onlyWhenSleepDisabled: false,
      },
    },
    sleepMode: true,
    hour: SUNSET_HOUR,
    brightness: 'AT_SUNSET',
    cct: 'AT_SUNSET',
  },
  {
    name: 'excludes a guarded sunrise while sleep mode is on, on both channels',
    overrides: sleepEnableOn,
    sleepMode: true,
    hour: SUNRISE_HOUR,
    brightness: 'SLEEP_MODE_ENABLE',
    cct: 'SLEEP_MODE_ENABLE',
  },
  {
    name: 'keeps an unguarded sunrise while sleep mode is on',
    overrides: {
      ...sleepEnableOn,
      AT_SUNRISE: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNRISE,
        enabled: true,
        activationTime: '07:00',
        onlyWhenSleepDisabled: false,
      },
    },
    sleepMode: true,
    hour: SUNRISE_HOUR,
    brightness: 'AT_SUNRISE',
    cct: 'AT_SUNRISE',
  },
  {
    name: 'keeps a guarded sunrise while sleep mode is off',
    overrides: sleepDisableOn,
    sleepMode: false,
    hour: SUNRISE_HOUR,
    brightness: 'AT_SUNRISE',
    cct: 'AT_SUNRISE',
  },
  {
    name: 'leaves the HMD connect brightness override and falls back on the free channel',
    overrides: {
      ...sleepEnableOn,
      HMD_CONNECT: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.HMD_CONNECT,
        enabled: true,
        changeColorTemperature: false,
      },
    },
    sleepMode: true,
    hour: SUNSET_HOUR,
    brightness: 'HMD_CONNECT',
    cct: 'SLEEP_MODE_ENABLE',
  },
  {
    name: 'leaves the free channel on sunset when sleep mode is off',
    overrides: {
      ...sleepDisableOn,
      HMD_CONNECT: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.HMD_CONNECT,
        enabled: true,
        changeColorTemperature: false,
      },
    },
    sleepMode: false,
    hour: SUNSET_HOUR,
    brightness: 'HMD_CONNECT',
    cct: 'AT_SUNSET',
  },
  {
    name: 'selects no event when the guard excludes sunset and no sleep event is enabled',
    overrides: {},
    sleepMode: true,
    hour: SUNSET_HOUR,
    brightness: undefined,
    cct: undefined,
  },
  {
    name: 'falls back on both channels when a guarded sunset changes brightness only',
    overrides: {
      ...sleepEnableOn,
      AT_SUNSET: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNSET,
        enabled: true,
        activationTime: '19:00',
        changeColorTemperature: false,
      },
    },
    sleepMode: true,
    hour: SUNSET_HOUR,
    brightness: 'SLEEP_MODE_ENABLE',
    cct: 'SLEEP_MODE_ENABLE',
  },
  {
    name: 'excludes a guarded sunrise selected by inverted activation times',
    overrides: {
      ...sleepEnableOn,
      AT_SUNRISE: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNRISE,
        enabled: true,
        activationTime: '22:00',
      },
      AT_SUNSET: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNSET,
        enabled: true,
        activationTime: '06:00',
      },
    },
    sleepMode: true,
    hour: 23,
    brightness: 'SLEEP_MODE_ENABLE',
    cct: 'SLEEP_MODE_ENABLE',
  },
  {
    name: 'keeps an unguarded sunset selected by inverted activation times',
    overrides: {
      ...sleepEnableOn,
      AT_SUNRISE: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNRISE,
        enabled: true,
        activationTime: '22:00',
      },
      AT_SUNSET: {
        ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS.AT_SUNSET,
        enabled: true,
        activationTime: '06:00',
        onlyWhenSleepDisabled: false,
      },
    },
    sleepMode: true,
    hour: 10,
    brightness: 'AT_SUNSET',
    cct: 'AT_SUNSET',
  },
];

describe('BrightnessCctAutomationService HMD connect selection', () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const result = await decideAt(
        buildConfig(testCase.overrides),
        testCase.sleepMode,
        testCase.hour
      );
      expect(result).toEqual({ brightness: testCase.brightness, cct: testCase.cct });
    });
  }

  it('still offers a guarded solar event as a potential automation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, SUNSET_HOUR, 0, 0));
    try {
      const service = createService(buildConfig(sleepEnableOn), true);
      const result = await service.determineHmdConnectAutomations();
      expect(result.brightnessAutomation).toBe('SLEEP_MODE_ENABLE');
      expect(result.potentialBrightnessAutomations).toContain('AT_SUNSET');
      expect(result.potentialBrightnessAutomations).toContain('AT_SUNRISE');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BrightnessCctAutomationService HMD connect with a Steam Frame', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Sleep automations change brightness only; the paired Frame has not reported yet. */
  function frameSetup() {
    const config = buildConfig({ ...sleepEnableOn, ...sleepDisableOn });
    config.AT_SUNSET.enabled = false;
    config.AT_SUNRISE.enabled = false;
    config.SLEEP_MODE_ENABLE.changeColorTemperature = false;
    config.SLEEP_MODE_DISABLE.changeColorTemperature = false;
    const sleepMode = new BehaviorSubject(false);
    let report!: (reported: boolean) => void;
    const simple = { setBrightness: vi.fn(async () => {}), cancelActiveTransition: vi.fn() };
    const hardware = {
      cancelActiveTransition: vi.fn(),
      whenActiveHmdReady: () => new Promise<boolean>((resolve) => (report = resolve)),
    };
    const service = new BrightnessCctAutomationService(
      { configs: new BehaviorSubject({ BRIGHTNESS_AUTOMATIONS: config }) } as never,
      { mode: sleepMode } as never,
      simple as never,
      hardware as never,
      { cancelActiveTransition: vi.fn() } as never,
      {} as never,
      { logEvent: vi.fn() } as never,
      {} as never,
      {} as never
    );
    const internals = service as unknown as {
      onHmdConnect(): Promise<void>;
      onAutomationTrigger(type: BrightnessEvent, config: unknown, instant: boolean): Promise<void>;
    };
    return { config, sleepMode, simple, internals, report: (value: boolean) => report(value) };
  }

  it('reruns the automation that fits when the Frame reports', async () => {
    const h = frameSetup();
    await h.internals.onHmdConnect();
    await vi.waitFor(() =>
      expect(h.simple.setBrightness).toHaveBeenLastCalledWith(100, expect.anything())
    );
    h.sleepMode.next(true);
    h.report(true);
    await vi.waitFor(() => expect(h.simple.setBrightness).toHaveBeenCalledTimes(2));
    expect(h.simple.setBrightness).toHaveBeenLastCalledWith(20, expect.anything());
  });

  it('skips the rerun when another brightness automation ran meanwhile', async () => {
    const h = frameSetup();
    await h.internals.onHmdConnect();
    await vi.waitFor(() => expect(h.simple.setBrightness).toHaveBeenCalled());
    await h.internals.onAutomationTrigger('SLEEP_MODE_ENABLE', h.config.SLEEP_MODE_ENABLE, true);
    h.simple.setBrightness.mockClear();
    h.report(true);
    await settle();
    await settle();
    expect(h.simple.setBrightness).not.toHaveBeenCalled();
  });

  it('does not rerun when the Frame leaves before it reports', async () => {
    const h = frameSetup();
    await h.internals.onHmdConnect();
    await vi.waitFor(() => expect(h.simple.setBrightness).toHaveBeenCalled());
    h.simple.setBrightness.mockClear();
    h.report(false);
    await settle();
    await settle();
    expect(h.simple.setBrightness).not.toHaveBeenCalled();
  });
});

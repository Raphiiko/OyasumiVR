import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../app-settings.service';
import type { AutomationConfigService } from '../automation-config.service';
import type { EventLogService } from '../event-log.service';
import type { SleepService } from '../sleep.service';
import type { SleepPreparationService } from '../sleep-preparation.service';
import type { HardwareBrightnessControlService } from '../brightness-control/hardware-brightness-control.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import { APP_SETTINGS_DEFAULT, type AppSettings } from '../../models/settings';
import { BigscreenBeyondFanAutomationService } from './bigscreen-beyond-fan-automation.service';

const fanCommands: number[] = [];

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/plugin-log', () => ({
  warn: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { speed: number }) => {
    switch (command) {
      case 'bigscreen_beyond_is_connected':
        return true;
      case 'bigscreen_beyond_get_saved_preferences':
        return '';
      case 'bigscreen_beyond_set_fan_speed':
        fanCommands.push(args!.speed);
        return undefined;
      default:
        return undefined;
    }
  }),
}));

function createService() {
  const settings = new BehaviorSubject<AppSettings>({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    bigscreenBeyondBrightnessFanSafety: false,
  });
  const brightness = new BehaviorSubject(50);
  const hardwareBrightness = {
    brightnessStream: brightness.asObservable(),
    get brightness() {
      return brightness.value;
    },
  };
  const service = new BigscreenBeyondFanAutomationService(
    {
      configs: new BehaviorSubject(structuredClone(AUTOMATION_CONFIGS_DEFAULT)).asObservable(),
    } as AutomationConfigService,
    { mode: new BehaviorSubject(false).asObservable() } as SleepService,
    { onSleepPreparation: new Subject<void>() } as unknown as SleepPreparationService,
    { settings: settings.asObservable() } as AppSettingsService,
    hardwareBrightness as unknown as HardwareBrightnessControlService,
    { logEvent: vi.fn() } as unknown as EventLogService
  );
  const safetyActive: boolean[] = [];
  service.fanSafetyActive.subscribe((active) => safetyActive.push(active));

  const setFanSafety = (enabled: boolean) =>
    settings.next({ ...settings.value, bigscreenBeyondBrightnessFanSafety: enabled });

  return { brightness, safetyActive, service, setFanSafety };
}

// past the 100 ms throttle on the fan safety setting
const settleSafety = () => vi.advanceTimersByTimeAsync(150);

async function activateSafetyAt120(context: ReturnType<typeof createService>) {
  await context.service.init();
  await vi.advanceTimersByTimeAsync(600);
  await context.service.setFanSpeed(60);
  context.brightness.next(120);
  context.setFanSafety(true);
  await settleSafety();
  expect(context.safetyActive.at(-1)).toBe(true);
  fanCommands.length = 0;
}

describe('BigscreenBeyondFanAutomationService fan safety', () => {
  beforeEach(() => {
    fanCommands.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the saved speed once when the setting is disabled above 100% brightness', async () => {
    const context = createService();
    await activateSafetyAt120(context);

    context.setFanSafety(false);
    await settleSafety();

    expect(fanCommands).toEqual([60]);
    expect(context.safetyActive.at(-1)).toBe(false);

    context.brightness.next(120);
    await settleSafety();
    context.brightness.next(130);
    await settleSafety();

    expect(fanCommands).toEqual([60]);
  });

  it('restores the saved speed when brightness returns to the safe range', async () => {
    const context = createService();
    await activateSafetyAt120(context);

    context.brightness.next(90);
    await settleSafety();

    expect(fanCommands).toEqual([60]);
    expect(context.safetyActive.at(-1)).toBe(false);
  });

  it('forces 100% again when the setting is re-enabled above 100% brightness', async () => {
    const context = createService();
    await activateSafetyAt120(context);

    context.setFanSafety(false);
    await settleSafety();
    fanCommands.length = 0;
    context.setFanSafety(true);
    await settleSafety();

    expect(fanCommands).toEqual([100]);
    expect(context.safetyActive.at(-1)).toBe(true);
  });
});

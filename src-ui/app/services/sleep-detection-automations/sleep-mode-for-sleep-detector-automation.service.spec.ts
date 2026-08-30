import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslocoService } from '@jsverse/transloco';
import type { AutomationConfigService } from '../automation-config.service';
import type { EventLogService } from '../event-log.service';
import type { NotificationService } from '../notification.service';
import type { OpenVRInputService } from '../openvr-input.service';
import type { SleepService } from '../sleep.service';
import type { TelemetryService } from '../telemetry.service';
import { AUTOMATION_CONFIGS_DEFAULT, type AutomationConfigs } from '../../models/automations';
import type { SleepDetectorStateReport } from '../../models/events';
import { OVRInputEventAction } from '../../models/ovr-input-event';
import type { SleepModeStatusChangeReason } from '../../models/sleep-mode';
import type { SleepingPose } from '../../models/sleeping-pose';
import {
  type SleepDetectorStateReportHandlingResult,
  SleepModeForSleepDetectorAutomationService,
} from './sleep-mode-for-sleep-detector-automation.service';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

const report: SleepDetectorStateReport = {
  distanceInLast15Minutes: 0,
  distanceInLast10Minutes: 0,
  distanceInLast5Minutes: 0,
  distanceInLast1Minute: 0,
  distanceInLast10Seconds: 0,
  rotationInLast15Minutes: 0,
  rotationInLast10Minutes: 0,
  rotationInLast5Minutes: 0,
  rotationInLast1Minute: 0,
  rotationInLast10Seconds: 0,
  startTime: 0,
  lastLog: 0,
};

function enabledConfigs(): AutomationConfigs {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  Object.assign(configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR, {
    enabled: true,
    sleepCheck: true,
    detectionWindowMinutes: 0,
    considerControllerPresence: false,
    considerSleepingPose: false,
  });
  return configs;
}

function createService() {
  const configs = new BehaviorSubject(enabledConfigs());
  const sleepMode = new BehaviorSubject(false);
  const pose = new BehaviorSubject<SleepingPose>('UNKNOWN');
  const inputState = new BehaviorSubject({
    [OVRInputEventAction.OpenOverlay]: [],
    [OVRInputEventAction.MuteMicrophone]: [],
    [OVRInputEventAction.IndicatePresence]: [],
    [OVRInputEventAction.OverlayInteract]: [],
  });
  const sleep = {
    mode: sleepMode.asObservable(),
    pose: pose.asObservable(),
    enableSleepMode: vi.fn(async (reason: SleepModeStatusChangeReason) => {
      if (!sleepMode.value) sleepMode.next(true);
      return reason;
    }),
    disableSleepMode: vi.fn(async () => {
      if (sleepMode.value) sleepMode.next(false);
    }),
  };
  const notifications = {
    send: vi.fn(async () => 'sleep-check-notification'),
    clearNotification: vi.fn(async () => {}),
    playSound: vi.fn(async () => {}),
  };
  const eventLog = { logEvent: vi.fn() };
  const service = new SleepModeForSleepDetectorAutomationService(
    { configs: configs.asObservable() } as AutomationConfigService,
    sleep as unknown as SleepService,
    notifications as unknown as NotificationService,
    { translate: vi.fn((key: string) => key) } as unknown as TranslocoService,
    eventLog as unknown as EventLogService,
    { state: inputState.asObservable() } as OpenVRInputService,
    { trackEvent: vi.fn(async () => {}) } as unknown as TelemetryService
  );
  const results: SleepDetectorStateReportHandlingResult[] = [];
  service.lastStateReportHandlingResult.subscribe((result) => {
    if (result) results.push(result);
  });

  return { configs, eventLog, notifications, results, service, sleep };
}

async function armSleepCheck(service: SleepModeForSleepDetectorAutomationService) {
  expect(await service.handleStateReportForEnable(report)).toBe('SLEEP_CHECK');
}

function automationEnableCalls(sleep: ReturnType<typeof createService>['sleep']) {
  return sleep.enableSleepMode.mock.calls.filter(([reason]) => reason.type === 'AUTOMATION');
}

describe('SleepModeForSleepDetectorAutomationService sleep check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels when the automation is disabled during the countdown', async () => {
    const { configs, notifications, results, service, sleep } = createService();
    await service.init();
    await armSleepCheck(service);

    const disabled = structuredClone(configs.value);
    disabled.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled = false;
    configs.next(disabled);
    await vi.advanceTimersByTimeAsync(20000);

    expect(automationEnableCalls(sleep)).toHaveLength(0);
    expect(results).toEqual([]);
    expect(notifications.clearNotification).toHaveBeenCalledWith('sleep-check-notification');
  });

  it('cancels after manual enable followed by disable', async () => {
    const { results, service, sleep } = createService();
    await service.init();
    await armSleepCheck(service);

    await sleep.enableSleepMode({ type: 'MANUAL' });
    await sleep.disableSleepMode();
    await vi.advanceTimersByTimeAsync(20000);

    expect(automationEnableCalls(sleep)).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it('enables sleep mode when eligibility stays unchanged', async () => {
    const { results, service, sleep } = createService();
    await service.init();
    await armSleepCheck(service);

    await vi.advanceTimersByTimeAsync(20000);

    expect(automationEnableCalls(sleep)).toHaveLength(1);
    expect(results).toEqual(['SLEEP_CHECK_USER_ASLEEP', 'SLEEP_MODE_ENABLED']);
  });

  it('preserves gesture cancellation behavior', async () => {
    const { eventLog, notifications, results, service, sleep } = createService();
    await service.init();
    await armSleepCheck(service);

    await service.dismissSleepCheck();
    await vi.advanceTimersByTimeAsync(20000);

    expect(automationEnableCalls(sleep)).toHaveLength(0);
    expect(results).toEqual(['SLEEP_CHECK_USER_AWAKE']);
    expect(eventLog.logEvent).toHaveBeenCalledWith({
      type: 'sleepDetectorEnableCancelled',
    });
    expect(notifications.playSound).toHaveBeenCalledOnce();
    expect(notifications.clearNotification).toHaveBeenCalledWith('sleep-check-notification');
  });

  it('does not publish success after duplicate manual enable', async () => {
    const { results, service, sleep } = createService();
    await service.init();
    await armSleepCheck(service);

    await sleep.enableSleepMode({ type: 'MANUAL' });
    await sleep.enableSleepMode({ type: 'MANUAL' });
    await vi.advanceTimersByTimeAsync(20000);

    expect(automationEnableCalls(sleep)).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it('does not arm after cancellation during notification delivery', async () => {
    const { configs, notifications, results, service, sleep } = createService();
    let deliverNotification: (id: string) => void = () => {};
    notifications.send.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          deliverNotification = resolve;
        })
    );
    await service.init();

    const handling = service.handleStateReportForEnable(report);
    await Promise.resolve();
    const disabled = structuredClone(configs.value);
    disabled.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled = false;
    configs.next(disabled);
    deliverNotification('late-notification');

    expect(await handling).toBe('SLEEP_CHECK');
    await vi.advanceTimersByTimeAsync(20000);
    expect(automationEnableCalls(sleep)).toHaveLength(0);
    expect(results).toEqual([]);
    expect(notifications.clearNotification).toHaveBeenCalledWith('late-notification');
  });
});

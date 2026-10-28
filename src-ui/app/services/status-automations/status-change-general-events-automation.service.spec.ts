import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from 'vrchat';
import type { AutomationConfigService } from '../automation-config.service';
import type { VRChatService } from '../vrchat-api/vrchat.service';
import type { SleepService } from '../sleep.service';
import type { SleepPreparationService } from '../sleep-preparation.service';
import type {
  ShutdownAutomationsService,
  ShutdownSequenceStage,
} from '../shutdown-automations.service';
import type { NotificationService } from '../notification.service';
import type { EventLogService } from '../event-log.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  type ChangeStatusGeneralEventsAutomationConfig,
} from '../../models/automations';
import { UserStatus } from '../../models/vrchat';
import { StatusChangeGeneralEventsAutomationService } from './status-change-general-events-automation.service';

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => {}),
}));

type Overrides = Partial<ChangeStatusGeneralEventsAutomationConfig>;

function buildConfig(overrides: Overrides = {}): ChangeStatusGeneralEventsAutomationConfig {
  const config = structuredClone(AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_GENERAL_EVENTS);
  config.enabled = true;
  return Object.assign(config, structuredClone(overrides));
}

function createService(config: ChangeStatusGeneralEventsAutomationConfig, userStatus: UserStatus) {
  const configs = new BehaviorSubject({ CHANGE_STATUS_GENERAL_EVENTS: config });
  const user = new BehaviorSubject<CurrentUser | null>({
    status: userStatus,
    statusDescription: '',
  } as CurrentUser);
  const stage = new BehaviorSubject<ShutdownSequenceStage>('IDLE');
  const setStatus = vi.fn(async () => true);
  const logEvent = vi.fn();

  const service = new StatusChangeGeneralEventsAutomationService(
    { configs: configs.asObservable() } as unknown as AutomationConfigService,
    { user: user.asObservable(), setStatus } as unknown as VRChatService,
    { mode: new Subject<boolean>().asObservable() } as unknown as SleepService,
    {
      onSleepPreparation: new Subject<void>().asObservable(),
    } as unknown as SleepPreparationService,
    { stage: stage.asObservable() } as unknown as ShutdownAutomationsService,
    { notificationTypeEnabled: vi.fn(async () => false) } as unknown as NotificationService,
    { translate: (key: string) => key } as never,
    { logEvent } as unknown as EventLogService
  );

  return { service, stage, user, setStatus, logEvent };
}

describe('StatusChangeGeneralEventsAutomationService shutdown sequence event', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sets status and message when the sequence starts and both options are on', async () => {
    const config = buildConfig({
      changeStatusOnShutdownSequence: true,
      statusOnShutdownSequence: UserStatus.Active,
      changeStatusMessageOnShutdownSequence: true,
      statusMessageOnShutdownSequence: 'gm',
    });
    const { service, stage, setStatus, logEvent } = createService(config, UserStatus.AskMe);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(UserStatus.Active, 'gm');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'statusChangedOnGeneralEvent', reason: 'SHUTDOWN_SEQUENCE' })
    );
  });

  it('sets only the status when just the status option is on', async () => {
    const config = buildConfig({
      changeStatusOnShutdownSequence: true,
      statusOnShutdownSequence: UserStatus.Active,
    });
    const { service, stage, setStatus } = createService(config, UserStatus.AskMe);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).toHaveBeenCalledWith(UserStatus.Active, null);
  });

  it('sets only the message when just the message option is on', async () => {
    const config = buildConfig({
      changeStatusMessageOnShutdownSequence: true,
      statusMessageOnShutdownSequence: 'gm',
    });
    const { service, stage, setStatus } = createService(config, UserStatus.AskMe);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).toHaveBeenCalledWith(null, 'gm');
  });

  it('does nothing when both options are off', async () => {
    const config = buildConfig();
    const { service, stage, setStatus } = createService(config, UserStatus.AskMe);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).not.toHaveBeenCalled();
  });

  it('does nothing when the automation is disabled', async () => {
    const config = buildConfig({
      enabled: false,
      changeStatusOnShutdownSequence: true,
    });
    const { service, stage, setStatus } = createService(config, UserStatus.AskMe);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).not.toHaveBeenCalled();
  });

  it('does nothing when the user is offline', async () => {
    const config = buildConfig({
      changeStatusOnShutdownSequence: true,
    });
    const { service, stage, setStatus } = createService(config, UserStatus.Offline);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).not.toHaveBeenCalled();
  });

  it('fires once per run, not on later stage changes or on return to IDLE', async () => {
    const config = buildConfig({
      changeStatusOnShutdownSequence: true,
      statusOnShutdownSequence: UserStatus.Active,
    });
    const { service, stage, setStatus } = createService(config, UserStatus.AskMe);
    await service.init();

    stage.next('TURNING_OFF_DEVICES');
    await vi.advanceTimersByTimeAsync(500);
    stage.next('QUITTING_STEAMVR');
    stage.next('POWERING_DOWN');
    stage.next('IDLE');
    await vi.advanceTimersByTimeAsync(500);

    expect(setStatus).toHaveBeenCalledTimes(1);
  });
});

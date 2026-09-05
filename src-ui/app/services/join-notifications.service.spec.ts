import { BehaviorSubject, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslocoService } from '@jsverse/transloco';
import type { AutomationConfigService } from './automation-config.service';
import type { NotificationService } from './notification.service';
import type { SleepService } from './sleep.service';
import type { VRChatService } from './vrchat-api/vrchat.service';
import type { VRChatLogService } from './vrchat-log.service';
import { AUTOMATION_CONFIGS_DEFAULT, type AutomationConfigs } from '../models/automations';
import type { VRChatLogEvent } from '../models/vrchat-log-event';
import { JoinNotificationsService } from './join-notifications.service';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

function configs(overrides: Partial<AutomationConfigs['JOIN_NOTIFICATIONS']>): AutomationConfigs {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  Object.assign(configs.JOIN_NOTIFICATIONS, { enabled: true }, overrides);
  return configs;
}

function createService(overrides: Partial<AutomationConfigs['JOIN_NOTIFICATIONS']>) {
  const logEvents = new Subject<VRChatLogEvent>();
  const send = vi.fn(async () => null);
  const playSoundConfig = vi.fn(async () => {});
  const service = new JoinNotificationsService(
    { configs: new BehaviorSubject(configs(overrides)) } as unknown as AutomationConfigService,
    { mode: new BehaviorSubject(false) } as unknown as SleepService,
    {
      user: new BehaviorSubject({ displayName: 'Me' }),
      world: new BehaviorSubject({ players: [], loaded: true, instanceId: 'instance' }),
      vrchatProcessActive: new BehaviorSubject(true),
      listFriends: async () => [],
    } as unknown as VRChatService,
    { send, playSoundConfig } as unknown as NotificationService,
    { logEvents } as unknown as VRChatLogService,
    { translate: () => 'message' } as unknown as TranslocoService
  );
  return { service, logEvents, send, playSoundConfig };
}

// the queue delays each entry by 500ms before it fires
async function emit(
  harness: ReturnType<typeof createService>,
  type: 'OnPlayerJoined' | 'OnPlayerLeft'
) {
  await harness.service.init();
  harness.logEvents.next({ type, displayName: 'Other' } as VRChatLogEvent);
  await vi.advanceTimersByTimeAsync(1000);
}

describe('JoinNotificationsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('plays the leave sound when only the leave sound mode selects the player', async () => {
    const harness = createService({ leaveNotification: 'DISABLED', leaveSoundMode: 'EVERYONE' });
    await emit(harness, 'OnPlayerLeft');
    expect(harness.playSoundConfig).toHaveBeenCalledTimes(1);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('stays silent when neither leave mode selects the player', async () => {
    const harness = createService({ leaveNotification: 'DISABLED', leaveSoundMode: 'DISABLED' });
    await emit(harness, 'OnPlayerLeft');
    expect(harness.playSoundConfig).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('sends the leave notification when only the leave notification selects the player', async () => {
    const harness = createService({ leaveNotification: 'EVERYONE', leaveSoundMode: 'DISABLED' });
    await emit(harness, 'OnPlayerLeft');
    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.playSoundConfig).not.toHaveBeenCalled();
  });

  it('plays the join sound when only the join sound mode selects the player', async () => {
    const harness = createService({ joinNotification: 'DISABLED', joinSoundMode: 'EVERYONE' });
    await emit(harness, 'OnPlayerJoined');
    expect(harness.playSoundConfig).toHaveBeenCalledTimes(1);
    expect(harness.send).not.toHaveBeenCalled();
  });
});

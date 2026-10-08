import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'lodash';
import type { Notification } from 'vrchat';
import type { TranslocoService } from '@jsverse/transloco';
import type { AppSettingsService } from './app-settings.service';
import type { AutomationConfigService } from './automation-config.service';
import type { EventLogService } from './event-log.service';
import type { MessageCenterService } from './message-center/message-center.service';
import type { NotificationService } from './notification.service';
import type { SleepPreparationService } from './sleep-preparation.service';
import type { SleepService } from './sleep.service';
import type { VRChatService } from './vrchat-api/vrchat.service';
import { AUTOMATION_CONFIGS_DEFAULT, type AutomationConfigs } from '../models/automations';
import { NotificationType, UserStatus } from '../models/vrchat';
import en from '../../assets/i18n/en.json';
import { InviteAutomationsService } from './invite-automations.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

function translate(key: string, params: Record<string, string> = {}): string {
  const value = get(en, key);
  if (typeof value !== 'string') throw new Error(`missing translation: ${key}`);
  return value.replace(/\{(\w+)\}/g, (_, name) => params[name]);
}

function createService(
  overrides: Partial<AutomationConfigs['AUTO_ACCEPT_INVITE_REQUESTS']>,
  { notificationEnabled = true, sleepMode = true } = {}
) {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  Object.assign(
    configs.AUTO_ACCEPT_INVITE_REQUESTS,
    {
      enabled: true,
      declineOnRequest: 'ALWAYS',
      playSoundOnInviteRequest: {
        ...configs.AUTO_ACCEPT_INVITE_REQUESTS.playSoundOnInviteRequest,
        enabled: true,
      },
      playSoundOnInvite: {
        ...configs.AUTO_ACCEPT_INVITE_REQUESTS.playSoundOnInvite,
        enabled: true,
      },
    },
    overrides
  );
  const order: string[] = [];
  const notifications = {
    notificationTypeEnabled: vi.fn(async () => notificationEnabled),
    send: vi.fn(async (content: string) => {
      order.push(`send: ${content}`);
      return null;
    }),
    playSoundConfig: vi.fn(async () => {
      order.push('sound');
    }),
  };
  const vrchat = {
    user: new BehaviorSubject({ status: UserStatus.Active }),
    world: new BehaviorSubject({ instanceId: 'instance', players: [] }),
    vrchatProcessActive: new BehaviorSubject(true),
    declineInviteOrInviteRequest: vi.fn(async () => ({ reply: 'Sleeping' })),
    deleteNotification: vi.fn(async () => {}),
    inviteUser: vi.fn(async () => undefined),
  };
  const service = new InviteAutomationsService(
    vrchat as unknown as VRChatService,
    { configs: new BehaviorSubject(configs) } as unknown as AutomationConfigService,
    {} as AppSettingsService,
    { mode: new BehaviorSubject(sleepMode) } as unknown as SleepService,
    { logEvent: vi.fn() } as unknown as EventLogService,
    notifications as unknown as NotificationService,
    { translate } as unknown as TranslocoService,
    {} as SleepPreparationService,
    { addMessage: vi.fn() } as unknown as MessageCenterService
  );
  const receive = (type: string) =>
    (
      service as unknown as { handleNotification(n: Partial<Notification>): Promise<void> }
    ).handleNotification({
      id: 'n',
      type,
      senderUserId: 'usr_bob',
      senderUsername: 'Bob',
    } as Partial<Notification>);
  return { receive, order, notifications, vrchat };
}

describe('InviteAutomationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['not on the whitelist', { listMode: 'WHITELIST', playerIds: [] }],
    ['on the blacklist', { listMode: 'BLACKLIST', playerIds: ['usr_bob'] }],
    [
      'in a full instance',
      { listMode: 'DISABLED', onlyBelowPlayerCountEnabled: true, onlyBelowPlayerCount: 0 },
    ],
  ] as const)(
    'notifies after declining an invite request from someone %s',
    async (_, overrides) => {
      const { receive, order } = createService(overrides);
      await receive(NotificationType.RequestInvite);
      expect(order).toContain('send: Automatically declined invite request from Bob');
    }
  );

  it('notifies after declining an invite request while sleep mode is off', async () => {
    const { receive, order } = createService(
      { onlyIfSleepModeEnabled: true },
      { sleepMode: false }
    );
    await receive(NotificationType.RequestInvite);
    expect(order).toContain('send: Automatically declined invite request from Bob');
  });

  it('notifies after declining an invite while asleep', async () => {
    const { receive, order } = createService({ declineInvitesWhileAsleep: true });
    await receive(NotificationType.Invite);
    expect(order).toContain('send: Automatically declined invite from Bob');
  });

  it('sends no notification when the type is turned off', async () => {
    const { receive, notifications } = createService(
      { listMode: 'WHITELIST', playerIds: [] },
      { notificationEnabled: false }
    );
    await receive(NotificationType.RequestInvite);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('sends no notification when the request is not declined', async () => {
    const { receive, notifications } = createService({
      listMode: 'WHITELIST',
      playerIds: [],
      declineOnRequest: 'DISABLED',
    });
    await receive(NotificationType.RequestInvite);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it.each([
    ['invite request', NotificationType.RequestInvite, { listMode: 'WHITELIST', playerIds: [] }],
    ['invite', NotificationType.Invite, { declineInvitesWhileAsleep: true }],
  ] as const)(
    'plays the %s sound without waiting for the notification',
    async (_, type, overrides) => {
      const { receive, notifications } = createService(overrides);
      notifications.send.mockImplementation(() => new Promise(() => {}));
      await receive(type);
      expect(notifications.send).toHaveBeenCalled();
      expect(notifications.playSoundConfig).toHaveBeenCalled();
    }
  );
});

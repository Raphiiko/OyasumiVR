import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'lodash';
import type { Notification } from 'vrchat';
import type { TranslocoService } from '@jsverse/transloco';
import type { AppSettingsService } from './app-settings.service';
import type { AutomationConfigService } from './automation-config.service';
import type { EventLogService } from './event-log.service';
import type { MessageCenterService } from './message-center/message-center.service';
import type { TelemetryService } from './telemetry/telemetry.service';
import type { NotificationService } from './notification.service';
import type { SleepPreparationService } from './sleep-preparation.service';
import type { SleepService } from './sleep.service';
import type { VRChatService } from './vrchat-api/vrchat.service';
import { AUTOMATION_CONFIGS_DEFAULT, type AutomationConfigs } from '../models/automations';
import { NotificationType, UserStatus } from '../models/vrchat';
import en from '../../assets/i18n/en.json';
import { InviteAutomationsService } from './invite-automations.service';
import { VRChatInviteRefusedError } from './vrchat-api/vrchat-api';

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
  const eventLog = { logEvent: vi.fn() };
  const telemetry = { trackEvent: vi.fn(async () => {}) };
  const service = new InviteAutomationsService(
    vrchat as unknown as VRChatService,
    { configs: new BehaviorSubject(configs) } as unknown as AutomationConfigService,
    {} as AppSettingsService,
    { mode: new BehaviorSubject(sleepMode) } as unknown as SleepService,
    eventLog as unknown as EventLogService,
    notifications as unknown as NotificationService,
    { translate } as unknown as TranslocoService,
    {} as SleepPreparationService,
    { addMessage: vi.fn() } as unknown as MessageCenterService,
    telemetry as unknown as TelemetryService
  );
  const receive = (type: string, senderUsername = 'Bob') =>
    (
      service as unknown as { handleNotification(n: Partial<Notification>): Promise<void> }
    ).handleNotification({
      id: 'n',
      type,
      senderUserId: 'usr_bob',
      senderUsername,
    } as Partial<Notification>);
  return { receive, order, notifications, vrchat, eventLog, telemetry };
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

  it.each([UserStatus.Active, UserStatus.JoinMe])(
    'keeps the invite request in VRChat when VRChat refuses the invite on %s status',
    async (status) => {
      const { receive, vrchat, notifications, eventLog } = createService({
        listMode: 'DISABLED',
        playSoundOnInviteRequest_onlyWhenUnhandled: true,
      });
      vrchat.user.next({ status });
      vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError('Not allowed'));
      await receive(NotificationType.RequestInvite);
      expect(vrchat.deleteNotification).not.toHaveBeenCalled();
      expect(eventLog.logEvent).toHaveBeenCalledExactlyOnceWith({
        type: 'failedInviteRequest',
        displayName: 'Bob',
        vrchatMessage: 'Not allowed',
      });
      expect(notifications.send).toHaveBeenCalledExactlyOnceWith(
        'Could not accept invite request from Bob'
      );
      expect(notifications.playSoundConfig).toHaveBeenCalled();
    }
  );

  it('removes the invite request after VRChat accepts the invite', async () => {
    const { receive, vrchat, eventLog } = createService({ listMode: 'DISABLED' });
    await receive(NotificationType.RequestInvite);
    expect(vrchat.inviteUser.mock.invocationCallOrder[0]).toBeLessThan(
      vrchat.deleteNotification.mock.invocationCallOrder[0]
    );
    expect(eventLog.logEvent).toHaveBeenCalled();
  });

  it('keeps the invite request in VRChat when the invite fails for another reason', async () => {
    const { receive, vrchat } = createService({ listMode: 'DISABLED' });
    vrchat.inviteUser.mockRejectedValue(new Response(null, { status: 500 }));
    await expect(receive(NotificationType.RequestInvite)).rejects.toBeInstanceOf(Response);
    expect(vrchat.deleteNotification).not.toHaveBeenCalled();
  });

  it.each(['Bob', '3ca4'])(
    'reports the refusal message without the sender name %s or VRChat IDs',
    async (senderUsername) => {
      const { receive, vrchat, telemetry } = createService({ listMode: 'DISABLED' });
      vrchat.inviteUser.mockRejectedValue(
        new VRChatInviteRefusedError(
          `${senderUsername} can't join wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b:1~private(usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469)`
        )
      );
      await receive(NotificationType.RequestInvite, senderUsername);
      expect(telemetry.trackEvent).toHaveBeenCalledExactlyOnceWith('vrchat_invite_refused', {
        message: "<name> can't join <id>:1~private(<id>)",
      });
    }
  );

  it('reports the refusal message without the current user name', async () => {
    const { receive, vrchat, telemetry } = createService({ listMode: 'DISABLED' });
    vrchat.user.next({ status: UserStatus.Active, displayName: 'Alice' });
    vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError("Alice can't invite Bob"));
    await receive(NotificationType.RequestInvite);
    await vi.waitFor(() =>
      expect(telemetry.trackEvent).toHaveBeenCalledExactlyOnceWith('vrchat_invite_refused', {
        message: "<name> can't invite <name>",
      })
    );
  });

  it('reports the refusal message without a user name that contains the sender name', async () => {
    const { receive, vrchat, telemetry } = createService({ listMode: 'DISABLED' });
    vrchat.user.next({ status: UserStatus.Active, displayName: 'Bobby' });
    vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError("Bobby can't invite Bob"));
    await receive(NotificationType.RequestInvite, 'Bob');
    await vi.waitFor(() =>
      expect(telemetry.trackEvent).toHaveBeenCalledExactlyOnceWith('vrchat_invite_refused', {
        message: "<name> can't invite <name>",
      })
    );
  });

  it('reports the refusal message without the name of a user who logs out during the request', async () => {
    const { receive, vrchat, telemetry } = createService({ listMode: 'DISABLED' });
    vrchat.user.next({ status: UserStatus.Active, displayName: 'Alice' });
    vrchat.inviteUser.mockImplementation(async () => {
      vrchat.user.next(null as never);
      throw new VRChatInviteRefusedError("Alice can't invite Bob");
    });
    await receive(NotificationType.RequestInvite);
    await vi.waitFor(() =>
      expect(telemetry.trackEvent).toHaveBeenCalledExactlyOnceWith('vrchat_invite_refused', {
        message: "<name> can't invite <name>",
      })
    );
  });

  it('cuts the reported refusal message to 200 characters', async () => {
    const { receive, vrchat, telemetry } = createService({ listMode: 'DISABLED' });
    vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError('x'.repeat(201)));
    await receive(NotificationType.RequestInvite);
    await vi.waitFor(() =>
      expect(telemetry.trackEvent).toHaveBeenCalledExactlyOnceWith('vrchat_invite_refused', {
        message: 'x'.repeat(200),
      })
    );
  });

  it('sends no notification for a refused invite when the type is turned off', async () => {
    const { receive, vrchat, notifications } = createService(
      { listMode: 'DISABLED' },
      { notificationEnabled: false }
    );
    vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError());
    await receive(NotificationType.RequestInvite);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('reports the raw body without IDs, cut short, when VRChat gives no message', async () => {
    const { receive, vrchat, telemetry } = createService({ listMode: 'DISABLED' });
    const body = `<html>Bob usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469 ${'x'.repeat(300)}</html>`;
    vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError(undefined, body));
    await receive(NotificationType.RequestInvite);
    const props = (telemetry.trackEvent.mock.calls[0] as unknown[])[1] as Record<string, string>;
    expect(props.message).toBe('');
    expect(props.body.startsWith('<html><name> <id> xxx')).toBe(true);
    expect(props.body).toHaveLength(200);
  });

  it('logs the refusal when telemetry fails', async () => {
    const { receive, vrchat, eventLog, telemetry } = createService({ listMode: 'DISABLED' });
    vrchat.inviteUser.mockRejectedValue(new VRChatInviteRefusedError());
    telemetry.trackEvent.mockRejectedValue(new Error('offline'));
    await receive(NotificationType.RequestInvite);
    await new Promise((resolve) => setTimeout(resolve));
    expect(eventLog.logEvent).toHaveBeenCalledOnce();
    expect(vrchat.deleteNotification).not.toHaveBeenCalled();
  });
});

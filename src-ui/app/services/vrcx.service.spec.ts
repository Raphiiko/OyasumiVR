import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'lodash';
import type { TranslocoService } from '@jsverse/transloco';
import type { AppSettingsService } from './app-settings.service';
import type { EventLogService } from './event-log.service';
import type { SleepPreparationService } from './sleep-preparation.service';
import type { SleepService } from './sleep.service';
import type { EventLogDraft, EventLogEntry } from '../models/event-log-entry';
import { UserStatus } from '../models/vrchat';
import type { VRCXEventLogType } from '../models/settings';
import en from '../../assets/i18n/en.json';
import { VRCXService } from './vrcx.service';

const invoke = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

function translate(key: string, params: Record<string, string> = {}): string {
  const value = get(en, key);
  if (typeof value !== 'string') throw new Error(`missing translation: ${key}`);
  return value.replace(/''/g, "'").replace(/\{(\w+)\}/g, (_, name) => params[name]);
}

function createService(enabled: VRCXEventLogType[]) {
  const loggedEvents = new Subject<EventLogEntry>();
  const service = new VRCXService(
    { mode: new Subject<boolean>() } as unknown as SleepService,
    { onSleepPreparation: new Subject<void>() } as unknown as SleepPreparationService,
    { translate } as unknown as TranslocoService,
    { settingsSync: { vrcxLogsEnabled: enabled } } as unknown as AppSettingsService,
    { loggedEvents } as unknown as EventLogService
  );
  void service.init();
  return (draft: EventLogDraft) => {
    loggedEvents.next({ ...draft, id: 'id', time: 0 } as EventLogEntry);
    return invoke.mock.calls.map((call) => (call as unknown[])[1]);
  };
}

const ALL: VRCXEventLogType[] = ['SleepMode', 'Invites', 'StatusChanges', 'GroupChanges'];

describe('VRCXService', () => {
  beforeEach(() => invoke.mockClear());

  it('logs an accepted invite request with its reason and reply', () => {
    const log = createService(ALL);
    expect(
      log({
        type: 'acceptedInviteRequest',
        displayName: 'Alice',
        mode: 'WHITELIST',
        message: 'Come on in',
      })
    ).toEqual([
      {
        msg: `Auto-accepted invite request from 'Alice' | As this player was whitelisted | Reply: "Come on in"`,
      },
    ]);
  });

  it('leaves out the reply when none was sent', () => {
    const log = createService(ALL);
    expect(log({ type: 'acceptedInviteRequest', displayName: 'Alice', mode: 'DISABLED' })).toEqual([
      {
        msg: `Auto-accepted invite request from 'Alice' | As invite requests from anyone are accepted`,
      },
    ]);
  });

  it('logs a declined invite request with its reason and reply', () => {
    const log = createService(ALL);
    expect(
      log({
        type: 'declinedInviteRequest',
        displayName: 'Bob',
        reason: 'PLAYER_COUNT_CONDITION_FAILED',
        message: 'Sleeping',
      })
    ).toEqual([
      {
        msg: `Auto-declined invite request from 'Bob' | As there were too many players in the instance | Reply: "Sleeping"`,
      },
    ]);
  });

  it('logs a status change with the player count threshold', () => {
    const log = createService(ALL);
    expect(
      log({
        type: 'statusChangedOnPlayerCountChange',
        reason: 'AT_LIMIT_OR_ABOVE',
        threshold: 4,
        newStatus: UserStatus.Busy,
        oldStatus: UserStatus.Active,
        newStatusMessage: 'Full',
        oldStatusMessage: '',
      })
    ).toEqual([
      {
        msg: `Changed your VRChat status to 'Full' (Do Not Disturb) | As the amount of players in your world reached the limit of 4`,
      },
    ]);
  });

  it('keeps the old status when only the status message changes', () => {
    const log = createService(ALL);
    expect(
      log({
        type: 'statusChangedOnGeneralEvent',
        reason: 'SLEEP_MODE_ENABLED',
        oldStatus: UserStatus.AskMe,
        newStatusMessage: 'Asleep',
        oldStatusMessage: 'Awake',
      })
    ).toEqual([
      { msg: `Changed your VRChat status to 'Asleep' (Ask Me) | As sleep mode was enabled` },
    ]);
  });

  it('logs a group change', () => {
    const log = createService(ALL);
    expect(
      log({
        type: 'vrchatGroupChanged',
        groupId: 'grp_1',
        groupName: 'Sleepers',
        isClearing: false,
        reason: 'SLEEP_PREPARATION',
      })
    ).toEqual([
      {
        msg: `Changed the VRChat group you represent to 'Sleepers' | As you prepared to go to sleep`,
      },
    ]);
  });

  it('skips event types that are turned off', () => {
    const log = createService(['SleepMode', 'StatusChanges', 'GroupChanges']);
    expect(
      log({
        type: 'declinedInvite',
        displayName: 'Bob',
        reason: 'SLEEP_MODE_ENABLED',
        message: 'Sleeping',
      })
    ).toEqual([]);
  });

  it('ignores event log entries that are not social events', () => {
    const log = createService(ALL);
    expect(log({ type: 'sleepModeEnabled', reason: { type: 'MANUAL' } })).toEqual([]);
  });
});

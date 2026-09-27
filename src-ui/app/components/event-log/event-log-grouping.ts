import { EventLogEntry, EventLogType } from '../../models/event-log-entry';

export type EventLogCause =
  'sleepModeEnabled' | 'sleepModeDisabled' | 'sleepPreparation' | 'sunset' | 'sunrise';

export interface EventLogGroup {
  kind: 'group';
  /** Id of the oldest member, so it stays stable while newer members join. */
  id: string;
  cause: EventLogCause;
  /** The entry that caused the group, absent when it was filtered out or never logged. */
  trigger?: EventLogEntry;
  /** Newest first, without the trigger. */
  entries: EventLogEntry[];
}

export interface EventLogSingle {
  kind: 'entry';
  id: string;
  entry: EventLogEntry;
}

export type EventLogItem = EventLogGroup | EventLogSingle;

// ponytail: fixed gap between members, per-cause windows if a delayed automation falls outside it
export const EVENT_LOG_GROUP_GAP = 60 * 1000;

const CAUSE_BY_REASON: Record<string, EventLogCause> = {
  SLEEP_MODE_ENABLED: 'sleepModeEnabled',
  SLEEP_MODE_ENABLE: 'sleepModeEnabled',
  SLEEP_TRIGGER: 'sleepModeEnabled',
  SLEEP_MODE_DISABLED: 'sleepModeDisabled',
  SLEEP_MODE_DISABLE: 'sleepModeDisabled',
  SLEEP_PREPARATION: 'sleepPreparation',
  AT_SUNSET: 'sunset',
  AT_SUNRISE: 'sunrise',
};

const TRIGGER_CAUSES: Partial<Record<EventLogType, EventLogCause>> = {
  sleepModeEnabled: 'sleepModeEnabled',
  sleepModeDisabled: 'sleepModeDisabled',
};

export function eventLogCause(entry: EventLogEntry): EventLogCause | undefined {
  const triggerCause = TRIGGER_CAUSES[entry.type];
  if (triggerCause) return triggerCause;
  // this reason means sleep mode was on when the invite came in, not that it just changed
  if (entry.type === 'declinedInvite') return undefined;
  const reason = 'reason' in entry ? entry.reason : undefined;
  return typeof reason === 'string' ? CAUSE_BY_REASON[reason] : undefined;
}

/** Time a row shows: the trigger's, or the oldest entry's when the group has no trigger. */
export function eventLogItemTime(item: EventLogItem): number {
  if (item.kind === 'entry') return item.entry.time;
  return item.trigger?.time ?? item.entries[item.entries.length - 1].time;
}

/**
 * Folds the entries a single cause produced into one group.
 * Expects entries newest first. Items come out sorted by the time they show, newest first.
 * Hidden types still bound their groups, so hiding a trigger does not merge adjacent bursts.
 */
export function groupEventLog(
  entries: EventLogEntry[],
  hiddenTypes: EventLogType[] = []
): EventLogItem[] {
  const items: EventLogItem[] = [];
  const openGroups = new Map<EventLogCause, { group: EventLogGroup; oldestTime: number }>();

  // collect each entry into the open group for its cause
  for (const entry of entries) {
    const cause = eventLogCause(entry);
    if (!cause) {
      items.push({ kind: 'entry', id: entry.id, entry });
      continue;
    }
    let open = openGroups.get(cause);
    if (!open || open.oldestTime - entry.time > EVENT_LOG_GROUP_GAP) {
      open = { group: { kind: 'group', id: entry.id, cause, entries: [] }, oldestTime: entry.time };
      openGroups.set(cause, open);
      items.push(open.group);
    }
    open.group.id = entry.id;
    open.oldestTime = entry.time;
    if (TRIGGER_CAUSES[entry.type] === cause) {
      // the trigger is logged before its effects, so nothing older belongs to this group
      open.group.trigger = entry;
      openGroups.delete(cause);
    } else {
      open.group.entries.push(entry);
    }
  }

  // drop hidden entries, then unwrap groups with a single member
  const isVisible = (entry: EventLogEntry) => !hiddenTypes.includes(entry.type);
  const visibleItems = items.flatMap((item): EventLogItem[] => {
    if (item.kind === 'entry') return isVisible(item.entry) ? [item] : [];
    const trigger = item.trigger && isVisible(item.trigger) ? item.trigger : undefined;
    const groupEntries = item.entries.filter(isVisible);
    const members = trigger ? [trigger, ...groupEntries] : groupEntries;
    if (members.length > 1) return [{ ...item, trigger, entries: groupEntries }];
    return members.map((entry) => ({ kind: 'entry', id: entry.id, entry }));
  });

  // place each group at the time its header shows
  return visibleItems.sort((a, b) => eventLogItemTime(b) - eventLogItemTime(a));
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogType, EventLogVRChatGroupChanged } from '../../../../models/event-log-entry';

export class EventLogVRChatGroupChangedEntryParser extends EventLogEntryParser<EventLogVRChatGroupChanged> {
  entryType(): EventLogType {
    return 'vrchatGroupChanged';
  }

  override headerInfoTitle(entry: EventLogVRChatGroupChanged): string {
    return entry.isClearing
      ? 'comp.event-log-entry.type.vrchatGroupChanged.title.clear'
      : 'comp.event-log-entry.type.vrchatGroupChanged.title.set';
  }

  override headerInfoTitleParams(entry: EventLogVRChatGroupChanged): {
    [p: string]: string;
  } {
    return {
      groupId: entry.groupId,
      groupName: entry.groupName || entry.groupId,
    };
  }

  override headerInfoSubTitle(entry: EventLogVRChatGroupChanged): string {
    if (!entry.reason) return '';
    return 'comp.event-log-entry.type.vrchatGroupChanged.reason.' + entry.reason;
  }
}

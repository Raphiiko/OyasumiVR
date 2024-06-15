import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogType, EventLogVRChatAvatarChanged } from '../../../models/event-log-entry';

export class EventLogVRChatAvatarChangedEntryParser extends EventLogEntryParser<EventLogVRChatAvatarChanged> {
  entryType(): EventLogType {
    return 'vrchatAvatarChanged';
  }

  override headerInfoTitleParams(entry: EventLogVRChatAvatarChanged): {
    [p: string]: string;
  } {
    return {
      avatarName: entry.avatarName,
    };
  }

  override headerInfoSubTitle(entry: EventLogVRChatAvatarChanged): string {
    return 'comp.event-log-entry.type.vrchatAvatarChanged.reason.' + entry.reason;
  }
}

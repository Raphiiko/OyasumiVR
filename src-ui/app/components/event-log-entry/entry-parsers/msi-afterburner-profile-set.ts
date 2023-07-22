import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogMsiAfterburnerProfileSet, EventLogType } from '../../../models/event-log-entry';

export class EventLogMsiAfterburnerProfileSetEntryParser extends EventLogEntryParser<EventLogMsiAfterburnerProfileSet> {
  entryType(): EventLogType {
    return 'msiAfterburnerProfileSet';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.msiAfterburnerProfileSet.title';
  }

  override headerInfoTitleParams(entry: EventLogMsiAfterburnerProfileSet): { [s: string]: string } {
    return {
      profile: entry.profile.toString(10),
    };
  }

  override headerInfoSubTitle(entry: EventLogMsiAfterburnerProfileSet): string {
    return 'comp.event-log-entry.type.msiAfterburnerProfileSet.reason.' + entry.reason;
  }
}

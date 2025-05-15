import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogFrameLimitChanged, EventLogType } from '../../../../models/event-log-entry';

export class EventLogFrameLimitChangedEntryParser extends EventLogEntryParser<EventLogFrameLimitChanged> {
  entryType(): EventLogType {
    return 'frameLimitChanged';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.frameLimitChanged.title';
  }

  override headerInfoTitleParams(entry: EventLogFrameLimitChanged): { [p: string]: string } {
    return {
      appName: entry.appName,
      limit: this.translate.instant(entry.limit),
    };
  }

  override headerInfoSubTitle(entry: EventLogFrameLimitChanged): string {
    return 'comp.event-log-entry.type.frameLimitChanged.reason.' + entry.reason;
  }
}

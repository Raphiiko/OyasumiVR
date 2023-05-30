import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogFadeDistanceChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogFadeDistanceChangedEntryParser extends EventLogEntryParser<EventLogFadeDistanceChanged> {
  entryType(): EventLogType {
    return 'fadeDistanceChanged';
  }

  override headerInfoTitle(entry: EventLogFadeDistanceChanged): string {
    return (
      'comp.event-log-entry.type.fadeDistanceChanged.title'
    );
  }

  override headerInfoTitleParams(entry: EventLogFadeDistanceChanged): { [p: string]: string } {
    return { value: entry.fadeDistance + "" };
  }

  override headerInfoSubTitle(entry: EventLogFadeDistanceChanged): string {
    return 'comp.event-log-entry.type.fadeDistanceChanged.reason.' + entry.reason;
  }
}

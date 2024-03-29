import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogSoftwareBrightnessChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogSoftwareBrightnessChangedEntryParser extends EventLogEntryParser<EventLogSoftwareBrightnessChanged> {
  entryType(): EventLogType {
    return 'softwareBrightnessChanged';
  }

  override headerInfoTitle(entry: EventLogSoftwareBrightnessChanged): string {
    return (
      'comp.event-log-entry.type.softwareBrightnessChanged.title.' +
      (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogSoftwareBrightnessChanged): {
    [p: string]: string;
  } {
    return {
      value: entry.value.toString() + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogSoftwareBrightnessChanged): string {
    return 'comp.event-log-entry.type.softwareBrightnessChanged.reason.' + entry.reason;
  }
}

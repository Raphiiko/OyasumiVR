import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogBrightnessChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogBrightnessChangedEntryParser extends EventLogEntryParser<EventLogBrightnessChanged> {
  entryType(): EventLogType {
    return 'brightnessChanged';
  }

  override headerInfoTitle(entry: EventLogBrightnessChanged): string {
    return (
      'comp.event-log-entry.type.brightnessChanged.title.' +
      (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogBrightnessChanged): { [p: string]: string } {
    return {
      value: entry.value.toString() + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogBrightnessChanged): string {
    return 'comp.event-log-entry.type.brightnessChanged.reason.' + entry.reason;
  }
}

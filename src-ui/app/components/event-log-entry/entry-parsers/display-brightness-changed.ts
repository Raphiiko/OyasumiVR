import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogDisplayBrightnessChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogDisplayBrightnessChangedEntryParser extends EventLogEntryParser<EventLogDisplayBrightnessChanged> {
  entryType(): EventLogType {
    return 'displayBrightnessChanged';
  }

  override headerInfoTitle(entry: EventLogDisplayBrightnessChanged): string {
    return (
      'comp.event-log-entry.type.displayBrightnessChanged.title.' +
      (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogDisplayBrightnessChanged): { [p: string]: string } {
    return {
      value: entry.value.toString() + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogDisplayBrightnessChanged): string {
    return 'comp.event-log-entry.type.displayBrightnessChanged.reason.' + entry.reason;
  }
}

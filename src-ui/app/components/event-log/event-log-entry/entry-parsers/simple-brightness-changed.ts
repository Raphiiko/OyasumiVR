import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogSimpleBrightnessChanged, EventLogType } from '../../../../models/event-log-entry';

export class EventLogSimpleBrightnessChangedEntryParser extends EventLogEntryParser<EventLogSimpleBrightnessChanged> {
  entryType(): EventLogType {
    return 'simpleBrightnessChanged';
  }

  override headerInfoTitle(entry: EventLogSimpleBrightnessChanged): string {
    return (
      'comp.event-log-entry.type.simpleBrightnessChanged.title.' +
      (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogSimpleBrightnessChanged): { [p: string]: string } {
    return {
      value: entry.value.toString() + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogSimpleBrightnessChanged): string {
    return 'comp.event-log-entry.type.simpleBrightnessChanged.reason.' + entry.reason;
  }
}

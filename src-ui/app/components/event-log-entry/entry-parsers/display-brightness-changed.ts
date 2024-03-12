import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogHardwareBrightnessChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogHardwareBrightnessChangedEntryParser extends EventLogEntryParser<EventLogHardwareBrightnessChanged> {
  entryType(): EventLogType {
    return 'hardwareBrightnessChanged';
  }

  override headerInfoTitle(entry: EventLogHardwareBrightnessChanged): string {
    return (
      'comp.event-log-entry.type.hardwareBrightnessChanged.title.' +
      (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogHardwareBrightnessChanged): {
    [p: string]: string;
  } {
    return {
      value: entry.value.toString() + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogHardwareBrightnessChanged): string {
    return 'comp.event-log-entry.type.hardwareBrightnessChanged.reason.' + entry.reason;
  }
}

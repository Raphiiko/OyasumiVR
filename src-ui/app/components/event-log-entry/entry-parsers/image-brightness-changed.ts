import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogImageBrightnessChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogImageBrightnessChangedEntryParser extends EventLogEntryParser<EventLogImageBrightnessChanged> {
  entryType(): EventLogType {
    return 'imageBrightnessChanged';
  }

  override headerInfoTitle(entry: EventLogImageBrightnessChanged): string {
    return (
      'comp.event-log-entry.type.imageBrightnessChanged.title.' +
      (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogImageBrightnessChanged): { [p: string]: string } {
    return {
      value: entry.value.toString() + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogImageBrightnessChanged): string {
    return 'comp.event-log-entry.type.imageBrightnessChanged.reason.' + entry.reason;
  }
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogChaperoneFadeDistanceChanged,
  EventLogType,
} from '../../../../models/event-log-entry';
import { ensurePrecision } from 'src-ui/app/utils/number-utils';

export class EventLogFadeDistanceChangedEntryParser extends EventLogEntryParser<EventLogChaperoneFadeDistanceChanged> {
  entryType(): EventLogType {
    return 'chaperoneFadeDistanceChanged';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.chaperoneFadeDistanceChanged.title';
  }

  override headerInfoTitleParams(entry: EventLogChaperoneFadeDistanceChanged): {
    [p: string]: string;
  } {
    return { value: ensurePrecision(entry.fadeDistance, 2) + 'm' };
  }

  override headerInfoSubTitle(entry: EventLogChaperoneFadeDistanceChanged): string {
    return 'comp.event-log-entry.type.chaperoneFadeDistanceChanged.reason.' + entry.reason;
  }
}

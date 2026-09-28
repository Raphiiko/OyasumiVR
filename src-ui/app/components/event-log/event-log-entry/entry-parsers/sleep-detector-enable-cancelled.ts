import {
  EventLogSleepDetectorEnableCancelled,
  EventLogType,
} from '../../../../models/event-log-entry';
import { EventLogEntryParser } from '../event-log-entry-parser';

export class EventLogSleepDetectorEnableCancelledEntryParser extends EventLogEntryParser<EventLogSleepDetectorEnableCancelled> {
  entryType(): EventLogType {
    return 'sleepDetectorEnableCancelled';
  }

  icon(): string {
    return 'sleep-cancelled';
  }

  override headerInfoSubTitle(): string {
    return 'comp.event-log-entry.type.sleepDetectorEnableCancelled.subtitle';
  }
}

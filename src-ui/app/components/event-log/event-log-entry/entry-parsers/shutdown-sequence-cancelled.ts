import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogShutdownSequenceCancelled,
  EventLogType,
} from '../../../../models/event-log-entry';

export class EventLogShutdownSequenceCancelledEntryParser extends EventLogEntryParser<EventLogShutdownSequenceCancelled> {
  entryType(): EventLogType {
    return 'shutdownSequenceCancelled';
  }

  override headerInfoSubTitle(entry: EventLogShutdownSequenceCancelled): string {
    return 'comp.event-log-entry.type.' + entry.type + '.reason.' + entry.reason;
  }
}

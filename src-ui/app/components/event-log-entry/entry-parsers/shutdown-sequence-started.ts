import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogShutdownSequenceStarted, EventLogType } from '../../../models/event-log-entry';

export class EventLogShutdownSequenceStartedEntryParser extends EventLogEntryParser<EventLogShutdownSequenceStarted> {
  entryType(): EventLogType {
    return 'shutdownSequenceStarted';
  }

  override headerInfoSubTitle(entry: EventLogShutdownSequenceStarted): string {
    return 'comp.event-log-entry.type.' + entry.type + '.reason.' + entry.reason;
  }
}

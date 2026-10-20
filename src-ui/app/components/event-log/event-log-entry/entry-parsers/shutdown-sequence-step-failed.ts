import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogShutdownSequenceStepFailed,
  EventLogType,
} from '../../../../models/event-log-entry';

export class EventLogShutdownSequenceStepFailedEntryParser extends EventLogEntryParser<EventLogShutdownSequenceStepFailed> {
  entryType(): EventLogType {
    return 'shutdownSequenceStepFailed';
  }

  icon(): string {
    return 'shutdown';
  }

  override headerInfoTitle(entry: EventLogShutdownSequenceStepFailed): string {
    return 'comp.event-log-entry.type.shutdownSequenceStepFailed.title.' + entry.step;
  }
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogChangedSystemMicControllerButtonBehavior,
  EventLogType,
} from '../../../models/event-log-entry';

export class EventLogChangedSystemMicControllerButtonBehaviorEntryParser extends EventLogEntryParser<EventLogChangedSystemMicControllerButtonBehavior> {
  entryType(): EventLogType {
    return 'changedSystemMicControllerButtonBehavior';
  }

  override headerInfoTitle(entry: EventLogChangedSystemMicControllerButtonBehavior): string {
    return (
      'comp.event-log-entry.type.changedSystemMicControllerButtonBehavior.title.' + entry.behavior
    );
  }

  override headerInfoSubTitle(entry: EventLogChangedSystemMicControllerButtonBehavior): string {
    return (
      'comp.event-log-entry.type.changedSystemMicControllerButtonBehavior.reason.' + entry.reason
    );
  }
}

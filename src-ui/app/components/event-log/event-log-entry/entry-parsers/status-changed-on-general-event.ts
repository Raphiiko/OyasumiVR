import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogStatusChangedOnGeneralEvent,
  EventLogType,
} from '../../../../models/event-log-entry';
import { statusChangeChipHtml } from './status-chip';

export class EventLogStatusChangedOnGeneralEventEntryParser extends EventLogEntryParser<EventLogStatusChangedOnGeneralEvent> {
  entryType(): EventLogType {
    return 'statusChangedOnGeneralEvent';
  }

  icon(): string {
    return 'status';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.statusChangedOnGeneralEvent.title';
  }

  override headerInfoTitleParams(entry: EventLogStatusChangedOnGeneralEvent): {
    [p: string]: string;
  } {
    return {
      statusChange: statusChangeChipHtml(
        entry.oldStatus,
        entry.oldStatusMessage,
        entry.newStatus ?? entry.oldStatus,
        entry.newStatusMessage ?? entry.oldStatusMessage
      ),
    };
  }

  override headerInfoSubTitle(entry: EventLogStatusChangedOnGeneralEvent): string {
    return `comp.event-log-entry.type.statusChangedOnGeneralEvent.reason.${entry.reason}`;
  }
}

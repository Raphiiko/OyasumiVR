import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogStatusChangedOnPlayerCountChange,
  EventLogType,
} from '../../../../models/event-log-entry';
import { statusChangeChipHtml } from './status-chip';

export class EventLogStatusChangedOnPlayerCountChangeEntryParser extends EventLogEntryParser<EventLogStatusChangedOnPlayerCountChange> {
  entryType(): EventLogType {
    return 'statusChangedOnPlayerCountChange';
  }

  icon(): string {
    return 'status';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.statusChangedOnPlayerCountChange.title';
  }

  override headerInfoTitleParams(entry: EventLogStatusChangedOnPlayerCountChange): {
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

  override headerInfoSubTitle(entry: EventLogStatusChangedOnPlayerCountChange): string {
    return `comp.event-log-entry.type.statusChangedOnPlayerCountChange.reason.${entry.reason}`;
  }

  override headerInfoSubTitleParams(entry: EventLogStatusChangedOnPlayerCountChange): {
    [p: string]: string;
  } {
    return {
      threshold: entry.threshold.toString(),
    };
  }
}

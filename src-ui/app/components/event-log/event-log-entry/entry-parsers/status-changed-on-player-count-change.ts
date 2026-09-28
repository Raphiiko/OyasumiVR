import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogStatusChangedOnPlayerCountChange,
  EventLogType,
} from '../../../../models/event-log-entry';
import { UserStatus } from '../../../../models/vrchat';
import { vrcStatusToString } from '../../../../utils/status-utils';

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
    const oldStatusColor = this.getStatusColor(entry.oldStatus);
    const newStatusColor = this.getStatusColor(entry.newStatus ?? entry.oldStatus);
    return {
      oldStatus: `<span class="status-dot" style="background: ${oldStatusColor}"></span><span>'${
        entry.oldStatusMessage.trim() ?? vrcStatusToString(entry.oldStatus)
      }'</span>`,
      newStatus: `<span class="status-dot" style="background: ${newStatusColor}"></span><span>'${
        entry.newStatusMessage?.trim() ?? vrcStatusToString(entry.newStatus ?? entry.oldStatus)
      }'</span>`,
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

  getStatusColor(status: UserStatus) {
    switch (status) {
      case UserStatus.Active:
        return 'var(--color-vrchat-status-green)';
      case UserStatus.JoinMe:
        return 'var(--color-vrchat-status-blue)';
      case UserStatus.AskMe:
        return 'var(--color-vrchat-status-orange)';
      case UserStatus.Busy:
        return 'var(--color-vrchat-status-red)';
      case UserStatus.Offline:
        return 'black';
    }
  }
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogStatusChangedOnPlayerCountChange,
  EventLogType,
} from '../../../models/event-log-entry';
import { UserStatus } from 'vrchat';

export class EventLogStatusChangedOnPlayerCountChangeEntryParser extends EventLogEntryParser<EventLogStatusChangedOnPlayerCountChange> {
  entryType(): EventLogType {
    return 'statusChangedOnPlayerCountChange';
  }

  override headerInfoTitle(entry: EventLogStatusChangedOnPlayerCountChange): string {
    return 'comp.event-log-entry.type.statusChangedOnPlayerCountChange.title';
  }

  override headerInfoTitleParams(entry: EventLogStatusChangedOnPlayerCountChange): {
    [p: string]: string;
  } {
    const oldStatusColor = this.getStatusColor(entry.oldStatus);
    const newStatusColor = this.getStatusColor(entry.newStatus);
    return {
      oldStatus: `<i class="material-icons-round" style="color: ${oldStatusColor}">brightness_1</i><span>${entry.oldStatus}</span>`,
      newStatus: `<i class="material-icons-round" style="color: ${newStatusColor}">brightness_1</i><span>${entry.newStatus}</span>`,
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

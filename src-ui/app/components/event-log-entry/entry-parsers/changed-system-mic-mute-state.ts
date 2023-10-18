import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogBase,
  EventLogChangedSystemMicMuteState,
  EventLogType,
} from '../../../models/event-log-entry';

export class EventLogChangedSystemMicMuteStateEntryParser extends EventLogEntryParser<EventLogBase> {
  entryType(): EventLogType {
    return 'changedSystemMicMuteState';
  }

  override headerInfoTitle(entry: EventLogChangedSystemMicMuteState): string {
    return (
      'comp.event-log-entry.type.changedSystemMicMuteState.title.' +
      (entry.muted ? 'MUTE' : 'UNMUTE')
    );
  }

  override headerInfoTitleParams(entry: EventLogChangedSystemMicMuteState): {
    [p: string]: string;
  } {
    return {
      deviceName: entry.deviceName,
    };
  }

  override headerInfoSubTitle(entry: EventLogChangedSystemMicMuteState): string {
    return 'comp.event-log-entry.type.changedSystemMicMuteState.reason.' + entry.reason;
  }
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogChangedVRChatMicMuteState, EventLogType } from '../../../models/event-log-entry';

export class EventLogChangedVRChatMicMuteStateEntryParser extends EventLogEntryParser<EventLogChangedVRChatMicMuteState> {
  entryType(): EventLogType {
    return 'changedVRChatMicMuteState';
  }

  override headerInfoTitle(entry: EventLogChangedVRChatMicMuteState): string {
    return (
      'comp.event-log-entry.type.changedVRChatMicMuteState.title.' +
      (entry.muted ? 'MUTE' : 'UNMUTE')
    );
  }

  override headerInfoSubTitle(entry: EventLogChangedVRChatMicMuteState): string {
    return 'comp.event-log-entry.type.changedVRChatMicMuteState.reason.' + entry.reason;
  }
}

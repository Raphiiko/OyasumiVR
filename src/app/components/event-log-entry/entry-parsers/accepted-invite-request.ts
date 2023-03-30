import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogType,
  EventLogBrightnessChanged,
  EventLogAcceptedInviteRequest,
} from '../../../models/event-log-entry';

export class EventLogAcceptedInviteRequestEntryParser extends EventLogEntryParser<EventLogAcceptedInviteRequest> {
  entryType(): EventLogType {
    return 'acceptedInviteRequest';
  }

  override headerInfoTitleParams(entry: EventLogAcceptedInviteRequest): { [p: string]: string } {
    return {
      displayName: entry.displayName,
    };
  }

  override headerInfoSubTitle(entry: EventLogAcceptedInviteRequest): string {
    switch (entry.mode) {
      case 'DISABLED':
        return '';
      case 'WHITELIST':
        return 'comp.event-log-entry.type.acceptedInviteRequest.subtitle.whitelist';
      case 'BLACKLIST':
        return 'comp.event-log-entry.type.acceptedInviteRequest.subtitle.blacklist';
    }
  }
}

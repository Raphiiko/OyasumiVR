import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogAcceptedInviteRequest, EventLogType } from '../../../../models/event-log-entry';

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
        return 'comp.event-log-entry.type.acceptedInviteRequest.subtitle.anyone';
      case 'WHITELIST':
        return 'comp.event-log-entry.type.acceptedInviteRequest.subtitle.whitelist';
      case 'BLACKLIST':
        return 'comp.event-log-entry.type.acceptedInviteRequest.subtitle.blacklist';
      case 'JOIN_ME':
        return 'comp.event-log-entry.type.acceptedInviteRequest.subtitle.joinMe';
    }
  }
}

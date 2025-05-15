import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogDeclinedInviteRequest, EventLogType } from '../../../../models/event-log-entry';

export class EventLogDeclinedInviteRequestEntryParser extends EventLogEntryParser<EventLogDeclinedInviteRequest> {
  entryType(): EventLogType {
    return 'declinedInviteRequest';
  }

  override headerInfoTitleParams(entry: EventLogDeclinedInviteRequest): { [p: string]: string } {
    return {
      displayName: entry.displayName,
    };
  }

  override headerInfoSubTitle(entry: EventLogDeclinedInviteRequest): string {
    return 'comp.event-log-entry.type.declinedInviteRequest.reason.' + entry.reason;
  }
}

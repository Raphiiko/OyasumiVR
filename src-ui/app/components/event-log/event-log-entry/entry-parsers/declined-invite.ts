import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogDeclinedInvite, EventLogType } from '../../../../models/event-log-entry';

export class EventLogDeclinedInviteEntryParser extends EventLogEntryParser<EventLogDeclinedInvite> {
  entryType(): EventLogType {
    return 'declinedInvite';
  }

  override headerInfoTitleParams(entry: EventLogDeclinedInvite): { [p: string]: string } {
    return {
      displayName: entry.displayName,
    };
  }

  override headerInfoSubTitle(entry: EventLogDeclinedInvite): string {
    return 'comp.event-log-entry.type.declinedInvite.reason.' + entry.reason;
  }
}

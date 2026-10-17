import { escape } from 'lodash';
import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogFailedInviteRequest, EventLogType } from '../../../../models/event-log-entry';

export class EventLogFailedInviteRequestEntryParser extends EventLogEntryParser<EventLogFailedInviteRequest> {
  entryType(): EventLogType {
    return 'failedInviteRequest';
  }

  icon(): string {
    return 'invite-declined';
  }

  override headerInfoTitleParams(entry: EventLogFailedInviteRequest): { [p: string]: string } {
    return {
      displayName: escape(entry.displayName),
    };
  }

  override headerInfoSubTitle(entry: EventLogFailedInviteRequest): string {
    return entry.vrchatMessage
      ? 'comp.event-log-entry.type.failedInviteRequest.subtitle.vrchatMessage'
      : 'comp.event-log-entry.type.failedInviteRequest.subtitle.noMessage';
  }

  override headerInfoSubTitleParams(entry: EventLogFailedInviteRequest): { [p: string]: string } {
    // the entry component renders this text as trusted HTML
    return {
      message: escape(entry.vrchatMessage ?? ''),
    };
  }
}

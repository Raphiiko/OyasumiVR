import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogBase, EventLogType } from '../../../models/event-log-entry';

export class EventLogTemplateEntryParser extends EventLogEntryParser<EventLogBase> {
  entryType(): EventLogType {
    return 'sleepModeEnabled'; // TODO
  }

  override headerInfoTitle(entry: EventLogBase): string {
    return super.headerInfoTitle(entry); // TODO
  }

  override headerInfoTitleParams(entry: EventLogBase): { [p: string]: string } {
    return super.headerInfoTitleParams(entry); // TODO
  }

  override headerInfoSubTitle(entry: EventLogBase): string {
    return super.headerInfoSubTitle(entry); // TODO
  }

  override headerInfoSubTitleParams(entry: EventLogBase): { [s: string]: string } {
    return super.headerInfoSubTitleParams(entry); // TODO
  }
}

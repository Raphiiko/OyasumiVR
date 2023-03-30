import { EventLogBase, EventLogType } from '../../models/event-log-entry';

export abstract class EventLogEntryParser<T extends EventLogBase> {
  abstract entryType(): EventLogType;

  headerInfoTitle(entry: T): string {
    return 'comp.event-log-entry.type.' + entry.type + '.title';
  }

  headerInfoTitleParams(entry: T): { [s: string]: string } {
    return {};
  }

  headerInfoSubTitle(entry: T): string {
    return '';
  }

  headerInfoSubTitleParams(entry: T): { [s: string]: string } {
    return {};
  }
}

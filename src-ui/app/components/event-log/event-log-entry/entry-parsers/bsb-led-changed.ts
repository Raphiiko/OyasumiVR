import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogBSBLedChanged, EventLogType } from '../../../../models/event-log-entry';

export class EventLogBSBLedChangedEntryParser extends EventLogEntryParser<EventLogBSBLedChanged> {
  entryType(): EventLogType {
    return 'bsbLedChanged';
  }

  icon(): string {
    return 'light-bulb';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.bsbLedChanged.title';
  }

  override headerInfoTitleParams(entry: EventLogBSBLedChanged): {
    [p: string]: string;
  } {
    return {
      color: `<span class="status-dot" style="background: rgb(${entry.color[0]},${entry.color[1]},${entry.color[2]})"></span>`,
    };
  }

  override headerInfoSubTitle(entry: EventLogBSBLedChanged): string {
    return 'comp.event-log-entry.type.bsbLedChanged.reason.' + entry.reason;
  }
}

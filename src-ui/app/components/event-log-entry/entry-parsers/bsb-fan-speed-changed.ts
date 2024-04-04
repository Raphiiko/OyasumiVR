import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogBSBFanSpeedChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogBSBFanSpeedChangedEntryParser extends EventLogEntryParser<EventLogBSBFanSpeedChanged> {
  entryType(): EventLogType {
    return 'bsbFanSpeedChanged';
  }

  override headerInfoTitle(entry: EventLogBSBFanSpeedChanged): string {
    return (
      'comp.event-log-entry.type.bsbFanSpeedChanged.title.' +
      (entry.speed === entry.effectiveSpeed ? 'exact' : 'adjusted')
    );
  }

  override headerInfoTitleParams(entry: EventLogBSBFanSpeedChanged): {
    [p: string]: string;
  } {
    return {
      setPercentage: Math.round(entry.effectiveSpeed) + '',
      requestedPercentage: Math.round(entry.speed) + '',
    };
  }

  override headerInfoSubTitle(entry: EventLogBSBFanSpeedChanged): string {
    return 'comp.event-log-entry.type.bsbFanSpeedChanged.reason.' + entry.reason;
  }
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogGpuPowerLimitChanged, EventLogType } from '../../../../models/event-log-entry';

export class EventLogGpuPowerLimitChangedEntryParser extends EventLogEntryParser<EventLogGpuPowerLimitChanged> {
  entryType(): EventLogType {
    return 'gpuPowerLimitChanged';
  }

  override headerInfoTitle(entry: EventLogGpuPowerLimitChanged): string {
    return (
      'comp.event-log-entry.type.gpuPowerLimitChanged.title.' +
      (entry.resetToDefault ? 'reset' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogGpuPowerLimitChanged): { [p: string]: string } {
    const limitUnit = entry.limitUnit ?? 'W';
    const formattedLimit =
      limitUnit === '%'
        ? `${entry.limit > 0 ? '+' : ''}${entry.limit}${limitUnit}`
        : `${entry.limit}${limitUnit}`;

    return {
      device: entry.device,
      limit: formattedLimit,
    };
  }

  override headerInfoSubTitle(entry: EventLogGpuPowerLimitChanged): string {
    return 'comp.event-log-entry.type.gpuPowerLimitChanged.reason.' + entry.reason;
  }
}

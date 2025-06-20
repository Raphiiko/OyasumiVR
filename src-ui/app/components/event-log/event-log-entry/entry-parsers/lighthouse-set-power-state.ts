import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogLighthouseSetPowerState, EventLogType } from '../../../../models/event-log-entry';

export class EventLogLighthouseSetPowerStateEntryParser extends EventLogEntryParser<EventLogLighthouseSetPowerState> {
  entryType(): EventLogType {
    return 'lighthouseSetPowerState';
  }

  override headerInfoTitle(entry: EventLogLighthouseSetPowerState): string {
    return 'comp.event-log-entry.type.lighthouseSetPowerState.' + entry.devices + '.' + entry.state;
  }

  override headerInfoSubTitle(entry: EventLogLighthouseSetPowerState): string {
    return 'comp.event-log-entry.type.lighthouseSetPowerState.reasons.' + entry.reason;
  }
}

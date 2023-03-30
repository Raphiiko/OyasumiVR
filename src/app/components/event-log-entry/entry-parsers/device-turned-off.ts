import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogSleepModeEnabled,
  EventLogTurnedOffDevices,
  EventLogType,
} from '../../../models/event-log-entry';

export class EventLogTurnedOffDevicesEntryParser extends EventLogEntryParser<EventLogTurnedOffDevices> {
  entryType(): EventLogType {
    return 'turnedOffDevices';
  }

  override headerInfoTitle(entry: EventLogTurnedOffDevices): string {
    return 'comp.event-log-entry.type.turnedOffDevices.title.' + entry.devices;
  }

  override headerInfoSubTitle(entry: EventLogTurnedOffDevices): string {
    return 'comp.event-log-entry.type.turnedOffDevices.reason.' + entry.reason;
  }
}

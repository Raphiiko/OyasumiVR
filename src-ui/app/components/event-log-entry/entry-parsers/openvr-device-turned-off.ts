import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogTurnedOffOpenVRDevices, EventLogType } from '../../../models/event-log-entry';

export class EventLogTurnedOffOpenVRDevicesEntryParser extends EventLogEntryParser<EventLogTurnedOffOpenVRDevices> {
  entryType(): EventLogType {
    return 'turnedOffOpenVRDevices';
  }

  override headerInfoTitle(entry: EventLogTurnedOffOpenVRDevices): string {
    return 'comp.event-log-entry.type.turnedOffOpenVRDevices.title.' + entry.devices;
  }

  override headerInfoSubTitle(entry: EventLogTurnedOffOpenVRDevices): string {
    return 'comp.event-log-entry.type.turnedOffOpenVRDevices.reason.' + entry.reason;
  }

  headerInfoSubTitleParams(entry: EventLogTurnedOffOpenVRDevices): { [p: string]: string } {
    return {
      threshold: entry.batteryThreshold?.toString() ?? '',
    };
  }
}

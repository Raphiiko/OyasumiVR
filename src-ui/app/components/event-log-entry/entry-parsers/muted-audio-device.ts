import { EventLogEntryParser } from '../event-log-entry-parser';
import {
  EventLogBase, EventLogChangedAudioDeviceVolume,
  EventLogMutedAudioDevice,
  EventLogType
} from "../../../models/event-log-entry";

export class EventLogMutedAudioDeviceEntryParser extends EventLogEntryParser<EventLogMutedAudioDevice> {
  entryType(): EventLogType {
    return 'mutedAudioDevice';
  }

  override headerInfoTitleParams(entry: EventLogMutedAudioDevice): {
    [p: string]: string;
  } {
    return {
      deviceName: entry.deviceName.driver
        ? `${entry.deviceName.display} (${entry.deviceName.driver})`
        : entry.deviceName.display,
    };
  }

  override headerInfoSubTitle(entry: EventLogMutedAudioDevice): string {
    return 'comp.event-log-entry.type.mutedAudioDevice.reason.' + entry.reason;
  }
}

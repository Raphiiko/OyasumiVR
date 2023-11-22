import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogType, EventLogUnmutedAudioDevice } from '../../../models/event-log-entry';

export class EventLogUnmutedAudioDeviceEntryParser extends EventLogEntryParser<EventLogUnmutedAudioDevice> {
  entryType(): EventLogType {
    return 'unmutedAudioDevice';
  }

  override headerInfoTitleParams(entry: EventLogUnmutedAudioDevice): {
    [p: string]: string;
  } {
    return {
      deviceName: entry.deviceName.driver
        ? `${entry.deviceName.display} (${entry.deviceName.driver})`
        : entry.deviceName.display,
    };
  }

  override headerInfoSubTitle(entry: EventLogUnmutedAudioDevice): string {
    return 'comp.event-log-entry.type.unmutedAudioDevice.reason.' + entry.reason;
  }
}

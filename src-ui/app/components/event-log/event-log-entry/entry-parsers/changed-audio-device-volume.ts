import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogChangedAudioDeviceVolume, EventLogType } from '../../../../models/event-log-entry';

export class EventLogChangedAudioDeviceVolumeEntryParser extends EventLogEntryParser<EventLogChangedAudioDeviceVolume> {
  entryType(): EventLogType {
    return 'changedAudioDeviceVolume';
  }

  override headerInfoTitleParams(entry: EventLogChangedAudioDeviceVolume): {
    [p: string]: string;
  } {
    return {
      deviceName: entry.deviceName.driver
        ? `${entry.deviceName.display} (${entry.deviceName.driver})`
        : entry.deviceName.display,
      percentage: entry.volume + '%',
    };
  }

  override headerInfoSubTitle(entry: EventLogChangedAudioDeviceVolume): string {
    return 'comp.event-log-entry.type.changedAudioDeviceVolume.reason.' + entry.reason;
  }
}

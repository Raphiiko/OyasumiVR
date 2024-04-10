import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogSleepModeDisabled, EventLogType } from '../../../models/event-log-entry';

export class EventLogSleepModeDisabledEntryParser extends EventLogEntryParser<EventLogSleepModeDisabled> {
  entryType(): EventLogType {
    return 'sleepModeDisabled';
  }

  override headerInfoSubTitle(entry: EventLogSleepModeDisabled): string {
    switch (entry.reason.type) {
      case 'MANUAL':
        return 'comp.event-log-entry.type.sleepModeDisabled.reason.manual';
      case 'HOTKEY':
        return 'comp.event-log-entry.type.sleepModeDisabled.reason.hotkey';
      case 'OSC_CONTROL':
        return 'comp.event-log-entry.type.sleepModeDisabled.reason.osc-control';
      case 'AUTOMATION':
        switch (entry.reason.automation) {
          case 'SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS':
          case 'SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE':
          case 'SLEEP_MODE_DISABLE_AT_TIME':
          case 'SLEEP_MODE_DISABLE_AFTER_TIME':
          case 'SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON':
          case 'NIGHTMARE_DETECTION':
            return `comp.event-log-entry.type.sleepModeDisabled.reason.automation.${entry.reason.automation}`;
          default:
            return 'comp.event-log-entry.type.sleepModeDisabled.reason.automation.unknown';
        }
    }
  }
}

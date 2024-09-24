import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogSleepModeEnabled, EventLogType } from '../../../../models/event-log-entry';

export class EventLogSleepModeEnabledEntryParser extends EventLogEntryParser<EventLogSleepModeEnabled> {
  entryType(): EventLogType {
    return 'sleepModeEnabled';
  }

  override headerInfoSubTitle(entry: EventLogSleepModeEnabled): string {
    switch (entry.reason.type) {
      case 'MANUAL':
        return 'comp.event-log-entry.type.sleepModeEnabled.reason.manual';
      case 'HOTKEY':
        return 'comp.event-log-entry.type.sleepModeEnabled.reason.hotkey';
      case 'OSC_CONTROL':
        return 'comp.event-log-entry.type.sleepModeEnabled.reason.osc-control';
      case 'MQTT':
        return 'comp.event-log-entry.type.sleepModeEnabled.reason.mqtt';
      case 'AUTOMATION':
        switch (entry.reason.automation) {
          case 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR':
          case 'SLEEP_MODE_ENABLE_AT_TIME':
          case 'SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE':
          case 'SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF':
          case 'SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD':
            return `comp.event-log-entry.type.sleepModeEnabled.reason.automation.${entry.reason.automation}`;
          default:
            return 'comp.event-log-entry.type.sleepModeEnabled.reason.automation.unknown';
        }
    }
  }
}

import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogType, EventLogWindowsPowerPolicySet } from '../../../../models/event-log-entry';

export class EventLogWindowsPowerPolicySetEntryParser extends EventLogEntryParser<EventLogWindowsPowerPolicySet> {
  entryType(): EventLogType {
    return 'windowsPowerPolicySet';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.windowsPowerPolicySet.title';
  }

  override headerInfoTitleParams(entry: EventLogWindowsPowerPolicySet): { [s: string]: string } {
    return {
      policy: entry.policyName,
    };
  }

  override headerInfoSubTitle(entry: EventLogWindowsPowerPolicySet): string {
    return 'comp.event-log-entry.type.windowsPowerPolicySet.reason.' + entry.reason;
  }
}

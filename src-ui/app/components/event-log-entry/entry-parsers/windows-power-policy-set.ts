import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogType, EventLogWindowsPowerPolicySet } from '../../../models/event-log-entry';
import { TranslateService } from '@ngx-translate/core';
import { inject } from '@angular/core';

export class EventLogWindowsPowerPolicySetEntryParser extends EventLogEntryParser<EventLogWindowsPowerPolicySet> {
  private translate = inject(TranslateService);

  entryType(): EventLogType {
    return 'windowsPowerPolicySet';
  }

  override headerInfoTitle(): string {
    return 'comp.event-log-entry.type.windowsPowerPolicySet.title';
  }

  override headerInfoTitleParams(entry: EventLogWindowsPowerPolicySet): { [s: string]: string } {
    return {
      policy: this.translate.instant(
        'comp.event-log-entry.type.windowsPowerPolicySet.policy.' + entry.policy
      ),
    };
  }

  override headerInfoSubTitle(entry: EventLogWindowsPowerPolicySet): string {
    return 'comp.event-log-entry.type.windowsPowerPolicySet.reason.' + entry.reason;
  }
}

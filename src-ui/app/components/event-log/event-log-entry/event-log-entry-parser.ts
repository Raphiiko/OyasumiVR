import { TranslocoService } from '@jsverse/transloco';
import { EventLogBase, EventLogType } from '../../../models/event-log-entry';
import { inject } from '@angular/core';

export abstract class EventLogEntryParser<T extends EventLogBase> {
  protected translate = inject(TranslocoService);

  abstract entryType(): EventLogType;

  headerInfoTitle(entry: T): string {
    return 'comp.event-log-entry.type.' + entry.type + '.title';
  }

  headerInfoTitleParams(_entry: T): { [s: string]: string } {
    return {};
  }

  headerInfoSubTitle(_entry: T): string {
    return '';
  }

  headerInfoSubTitleParams(_entry: T): { [s: string]: string } {
    return {};
  }
}

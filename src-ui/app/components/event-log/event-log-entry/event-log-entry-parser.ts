import { TranslateService } from '@ngx-translate/core';
import { EventLogBase, EventLogType } from '../../../models/event-log-entry';
import { inject } from '@angular/core';

export abstract class EventLogEntryParser<T extends EventLogBase> {
  protected translate = inject(TranslateService);

  abstract entryType(): EventLogType;

  headerInfoTitle(entry: T): string {
    return 'comp.event-log-entry.type.' + entry.type + '.title';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  headerInfoTitleParams(entry: T): { [s: string]: string } {
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  headerInfoSubTitle(entry: T): string {
    return '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  headerInfoSubTitleParams(entry: T): { [s: string]: string } {
    return {};
  }
}

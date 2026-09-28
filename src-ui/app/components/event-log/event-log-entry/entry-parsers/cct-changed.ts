import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogCCTChanged, EventLogType } from '../../../../models/event-log-entry';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';

export class EventLogCCTChangedEntryParser extends EventLogEntryParser<EventLogCCTChanged> {
  cssColorCache: Record<number, string> = {};

  entryType(): EventLogType {
    return 'cctChanged';
  }

  icon(): string {
    return 'brightness-cct';
  }

  override headerInfoTitle(entry: EventLogCCTChanged): string {
    return (
      'comp.event-log-entry.type.cctChanged.title.' + (entry.transition ? 'transition' : 'set')
    );
  }

  override headerInfoTitleParams(entry: EventLogCCTChanged): {
    [p: string]: string;
  } {
    return {
      temperature: entry.value.toString(10),
      icon: `<span class="status-dot" style="background: ${
        this.cssColorCache[entry.value] ?? this.getCSSColorForCCT(entry.value)
      }"></span>`,
    };
  }

  override headerInfoSubTitle(entry: EventLogCCTChanged): string {
    return 'comp.event-log-entry.type.cctChanged.reason.' + entry.reason;
  }

  getCSSColorForCCT(cct: number): string {
    const cached = this.cssColorCache[cct];
    if (cached) return cached;
    const color = getCSSColorForCCT(cct);
    return (this.cssColorCache[cct] = color);
  }
}

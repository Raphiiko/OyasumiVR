import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogRenderResolutionChanged, EventLogType } from '../../../models/event-log-entry';

export class EventLogRenderResolutionChangedEntryParser extends EventLogEntryParser<EventLogRenderResolutionChanged> {
  entryType(): EventLogType {
    return 'renderResolutionChanged';
  }

  override headerInfoTitle(entry: EventLogRenderResolutionChanged): string {
    return (
      'comp.event-log-entry.type.renderResolutionChanged.title.' +
      (entry.resolution === null ? 'auto' : 'custom')
    );
  }

  override headerInfoTitleParams(entry: EventLogRenderResolutionChanged): { [p: string]: string } {
    return entry.resolution === null ? {} : { value: Math.round(entry.resolution) + '%' };
  }

  override headerInfoSubTitle(entry: EventLogRenderResolutionChanged): string {
    return 'comp.event-log-entry.type.renderResolutionChanged.reason.' + entry.reason;
  }
}

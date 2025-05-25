import { EventLogEntryParser } from '../event-log-entry-parser';
import { EventLogRunAutomationExecuted, EventLogType } from '../../../../models/event-log-entry';

export class EventLogRunAutomationExecutedEntryParser extends EventLogEntryParser<EventLogRunAutomationExecuted> {
    entryType(): EventLogType {
        return 'runAutomationExecuted';
    }

    override headerInfoTitle(): string {
        return 'comp.event-log-entry.type.runAutomationExecuted.title';
    }

    override headerInfoTitleParams(entry: EventLogRunAutomationExecuted): { [p: string]: string } {
        return {
            automationName: this.translate.instant('comp.event-log-entry.type.runAutomationExecuted.automationName.' + entry.automationName),
        };
    }

    override headerInfoSubTitle(entry: EventLogRunAutomationExecuted): string {
        return 'comp.event-log-entry.type.runAutomationExecuted.reason.' + entry.reason;
    }
} 
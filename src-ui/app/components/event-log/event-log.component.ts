import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { EventLogService } from '../../services/event-log.service';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { EventLogEntry, EventLogType } from '../../models/event-log-entry';
import { fade, hshrink, noop, vshrink } from '../../utils/animations';
import { ModalService } from 'src-ui/app/services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../confirm-modal/confirm-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EventLogFilterDialogComponent,
  EventLogFilterDialogInputModel,
  EventLogFilterDialogOutputModel,
} from './event-log-filter-dialog/event-log-filter-dialog.component';
import { AppSettingsService } from '../../services/app-settings.service';
import {
  EventLogCause,
  EventLogGroup,
  EventLogItem,
  eventLogItemTime,
  groupEventLog,
} from './event-log-grouping';
import { EVENT_LOG_ICONS } from './event-log-entry/event-log-entry.component';

const CAUSE_ICONS: Record<EventLogCause, string> = {
  sleepModeEnabled: 'sleep',
  sleepModeDisabled: 'sleep-off',
  sleepPreparation: 'bed',
  sunset: 'twilight',
  sunrise: 'twilight',
};

@Component({
  selector: 'app-event-log',
  templateUrl: './event-log.component.html',
  styleUrls: ['./event-log.component.scss'],
  animations: [vshrink(), noop(), fade(), hshrink()],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class EventLogComponent implements OnInit, AfterViewInit {
  private readonly pageSize = 10;
  private showCount = new BehaviorSubject<number>(this.pageSize);
  protected entries = 0;

  protected itemsInView: Observable<EventLogItem[]>;
  protected expandedGroups = new Set<string>();
  animationPause = true;
  clearHover = false;
  filterHover = false;
  filters = new BehaviorSubject<EventLogType[]>([]);

  constructor(
    private eventLog: EventLogService,
    private cdr: ChangeDetectorRef,
    private modalService: ModalService,
    private appSettings: AppSettingsService
  ) {
    this.itemsInView = combineLatest([this.eventLog.eventLog, this.showCount, this.filters]).pipe(
      map(
        ([log, showCount, filters]) =>
          [groupEventLog(log.logs, filters), showCount] as [EventLogItem[], number]
      ),
      tap(([items]) => {
        this.entries = items.length;
        this.cdr.detectChanges();
      }),
      map(([items, showCount]) => items.slice(0, showCount)),
      takeUntilDestroyed()
    );
    this.appSettings.settings.pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.filters.next(settings.eventLogTypesHidden);
    });
  }

  ngOnInit(): void {}

  ngAfterViewInit() {
    this.animationPause = false;
    this.cdr.detectChanges();
  }

  get pages(): number[] {
    const pages = Math.ceil(this.entries / this.pageSize);
    return Array.from(Array(pages).keys()).map((key) => key + 1);
  }

  protected entryIcon(entry: EventLogEntry): string {
    return EVENT_LOG_ICONS[entry.type];
  }

  protected causeIcon(group: EventLogGroup): string {
    return CAUSE_ICONS[group.cause];
  }

  protected groupTime(group: EventLogGroup): number {
    return eventLogItemTime(group);
  }

  /** False when the entry happened within the same second as its group header. */
  protected showEntryTime(entry: EventLogEntry, group: EventLogGroup): boolean {
    return Math.floor(entry.time / 1000) !== Math.floor(this.groupTime(group) / 1000);
  }

  protected toggleGroup(group: EventLogGroup) {
    if (!this.expandedGroups.delete(group.id)) this.expandedGroups.add(group.id);
  }

  showMore() {
    this.showCount.next(
      this.showCount.value + Math.min(this.pageSize, this.entries - this.showCount.value)
    );
  }

  hasMore(): boolean {
    return this.showCount.value < this.entries;
  }

  clearLog() {
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'comp.event-log.clearLogModal.title',
        message: 'comp.event-log.clearLogModal.message',
      })
      .subscribe((data) => {
        if (data?.confirmed) {
          this.eventLog.clearLog();
        }
      });
  }

  openFilterDialog() {
    this.modalService
      .addModal<EventLogFilterDialogInputModel, EventLogFilterDialogOutputModel>(
        EventLogFilterDialogComponent,
        {
          hiddenLogTypes: [...this.filters.value],
        }
      )
      .subscribe((data) => {
        if (data?.madeChanges) this.filters.next(data.hiddenLogTypes);
        this.appSettings.updateSettings({ eventLogTypesHidden: this.filters.value });
      });
  }
}

import { AfterViewInit, ChangeDetectorRef, Component, OnInit } from '@angular/core';
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

@Component({
  selector: 'app-event-log',
  templateUrl: './event-log.component.html',
  styleUrls: ['./event-log.component.scss'],
  animations: [vshrink(), noop(), fade(), hshrink()],
})
export class EventLogComponent implements OnInit, AfterViewInit {
  private readonly pageSize = 10;
  private showCount = new BehaviorSubject<number>(this.pageSize);
  protected entries = 0;

  protected logsInView: Observable<EventLogEntry[]>;
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
    this.logsInView = combineLatest([this.eventLog.eventLog, this.showCount, this.filters]).pipe(
      takeUntilDestroyed(),
      map(
        ([log, showCount, filters]) =>
          [log.logs.filter((log) => !filters.includes(log.type)), showCount, filters] as [
            EventLogEntry[],
            number,
            EventLogType[]
          ]
      ),
      tap(([logs]) => {
        this.entries = logs.length;
        this.cdr.detectChanges();
      }),
      map(([logs, showCount]) => logs.slice(0, showCount))
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

  protected trackLogEntryBy(index: number, entry: EventLogEntry) {
    return entry.id;
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
        if (data) this.filters.next(data.hiddenLogTypes);
        this.appSettings.updateSettings({ eventLogTypesHidden: this.filters.value });
      });
  }
}

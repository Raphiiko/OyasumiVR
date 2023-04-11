import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { EventLogService } from '../../services/event-log.service';
import { BehaviorSubject, combineLatest, map, Observable, Subject, takeUntil, tap } from 'rxjs';
import { EventLogEntry } from '../../models/event-log-entry';
import { fade, hshrink, noop, vshrink } from '../../utils/animations';
import { SimpleModalService } from 'ngx-simple-modal';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-event-log',
  templateUrl: './event-log.component.html',
  styleUrls: ['./event-log.component.scss'],
  animations: [vshrink(), noop(), fade(), hshrink()],
})
export class EventLogComponent implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();
  private readonly pageSize = 10;
  private showCount = new BehaviorSubject<number>(this.pageSize);
  protected entries = 0;

  protected logsInView: Observable<EventLogEntry[]>;
  animationPause = true;
  clearHover = false;

  constructor(
    private eventLog: EventLogService,
    private cdr: ChangeDetectorRef,
    private modalService: SimpleModalService
  ) {
    this.logsInView = combineLatest([this.eventLog.eventLog, this.showCount]).pipe(
      takeUntil(this.destroy$),
      tap(([log]) => {
        this.entries = log.logs.length;
        this.cdr.detectChanges();
      }),
      map(([log, showCount]) => log.logs.slice(0, showCount))
    );
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
  }

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
      .addModal(ConfirmModalComponent, {
        title: 'comp.event-log.clearLogModal.title',
        message: 'comp.event-log.clearLogModal.message',
      })
      .subscribe((data) => {
        if (data.confirmed) {
          this.eventLog.clearLog();
        }
      });
  }
}

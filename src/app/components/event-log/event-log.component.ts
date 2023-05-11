import { AfterViewInit, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { EventLogService } from '../../services/event-log.service';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { EventLogEntry } from '../../models/event-log-entry';
import { fade, hshrink, noop, vshrink } from '../../utils/animations';
import { ModalService } from 'src/app/services/modal.service';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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

  constructor(
    private eventLog: EventLogService,
    private cdr: ChangeDetectorRef,
    private modalService: ModalService
  ) {
    this.logsInView = combineLatest([this.eventLog.eventLog, this.showCount]).pipe(
      takeUntilDestroyed(),
      tap(([log]) => {
        this.entries = log.logs.length;
        this.cdr.detectChanges();
      }),
      map(([log, showCount]) => log.logs.slice(0, showCount))
    );
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

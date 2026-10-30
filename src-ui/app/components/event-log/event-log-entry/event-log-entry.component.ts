import { ChangeDetectorRef, Component, DestroyRef, OnChanges, OnInit, input } from '@angular/core';
import { EventLogEntryParser } from './event-log-entry-parser';
import { EventLogEntryParsers } from './event-log-entry-parsers.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventLogEntry } from '../../../models/event-log-entry';

@Component({
  selector: 'app-event-log-entry',
  templateUrl: './event-log-entry.component.html',
  styleUrls: ['./event-log-entry.component.scss'],
  standalone: false,
})
export class EventLogEntryComponent implements OnInit, OnChanges {
  parser?: EventLogEntryParser<any>;
  headerInfoTitle?: SafeHtml;
  headerInfoSubTitle?: SafeHtml;

  constructor(
    private parsers: EventLogEntryParsers,
    private sanitizer: DomSanitizer,
    private translate: TranslocoService,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {}

  readonly entry = input<EventLogEntry>();
  /** Hides the subtitle and the date, for entries that share them with their group header. */
  readonly compact = input(false);
  readonly showTime = input(true);
  /** Overrides the entry's own icon, for a group header. */
  readonly icon = input<string>();
  /** Marks the row as a warning, for a group header with a failed action. */
  readonly warning = input(false);
  protected iconName?: string;
  protected isWarning = false;
  /** Translation key for a header row that has no entry of its own. */
  readonly titleKey = input<string>();
  /** Time for a header row that has no entry of its own. */
  readonly time = input<number>();

  ngOnInit() {
    this.ngOnChanges();
    this.translate.langChanges$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.rebuild();
      this.cdr.markForCheck();
    });
  }

  get entryTime(): number | undefined {
    return this.entry()?.time ?? this.time();
  }

  ngOnChanges() {
    this.parser = this.parsers.forEntry(this.entry());
    this.rebuild();
  }

  rebuild() {
    const entry = this.entry();
    this.iconName = this.icon() ?? (entry && this.parser?.icon(entry));
    this.isWarning = this.warning() || (!this.icon() && !!entry && !!this.parser?.isWarning(entry));
    this.headerInfoSubTitle = undefined;
    if (!this.parser) {
      const titleKey = this.titleKey();
      if (titleKey) this.headerInfoTitle = this.translate.translate(titleKey);
      return;
    }
    let key = this.parser.headerInfoTitle(this.entry());
    // each title has a _FAILED sibling for an entry that reports a failure
    if (key && entry?.failure) key += '_FAILED';
    if (key) {
      this.headerInfoTitle = this.sanitizer.bypassSecurityTrustHtml(
        this.translate.translate(key, this.parser?.headerInfoTitleParams(this.entry()) ?? {})
      );
    }
    // a failed entry shows its hint in place of the reason
    if (entry?.failure) {
      this.headerInfoSubTitle = this.sanitizer.bypassSecurityTrustHtml(
        this.translate.translate('comp.event-log-entry.failure.' + entry.failure)
      );
      return;
    }
    key = this.compact() ? '' : this.parser.headerInfoSubTitle(this.entry());
    if (key) {
      this.headerInfoSubTitle = this.sanitizer.bypassSecurityTrustHtml(
        this.translate.translate(key, this.parser?.headerInfoSubTitleParams(this.entry()) ?? {})
      );
    }
  }
}

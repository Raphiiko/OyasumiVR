import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { NG_LOCALE_MAP } from '../globals';

@Pipe({
  name: 'localizedDate',
  pure: false,
  standalone: false,
})
export class LocalizedDatePipe implements PipeTransform, OnDestroy {
  private subscription: Subscription;

  constructor(
    private translateService: TranslocoService,
    private cdr: ChangeDetectorRef
  ) {
    // markForCheck is what keeps an OnPush view in sync: the pipe is impure,
    // so it only re-runs while its view is being checked.
    this.subscription = this.translateService.langChanges$.subscribe(() =>
      this.cdr.markForCheck()
    );
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  transform(value: any, pattern = 'mediumDate'): any {
    let currentLang = this.translateService.getActiveLang()!;
    if (currentLang === 'DEBUG') currentLang = 'en';
    const datePipe: DatePipe = new DatePipe(NG_LOCALE_MAP[currentLang]);
    pattern = this.getPatternFromPreset(currentLang, pattern);
    return datePipe.transform(value, pattern);
  }

  private getPatternFromPreset(currentLang: string, pattern: string): string {
    switch (pattern) {
      case 'EVENT_LOG_TIME': {
        return 'HH:mm:ss';
      }
      case 'EVENT_LOG_DATE': {
        switch (currentLang) {
          case 'ja':
            return 'MMMMd日';
          case 'ko':
            return 'MMMMd일';
          default:
            return 'MMMM d';
        }
      }
      default:
        return pattern;
    }
  }
}

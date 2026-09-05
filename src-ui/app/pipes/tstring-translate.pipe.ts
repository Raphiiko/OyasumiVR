import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { TString } from '../models/translatable-string';

@Pipe({
  name: 'tsTranslate',
  pure: false,
  standalone: false,
})
export class TStringTranslatePipe implements PipeTransform, OnDestroy {
  private subscription?: Subscription;
  private lastKey?: string;
  private lastValue = '';

  constructor(
    private translate: TranslocoService,
    private cdr: ChangeDetectorRef
  ) {}

  transform(value?: TString): unknown {
    if (!value) return '';
    const key = typeof value === 'string' ? value : value.string;
    const values = typeof value === 'string' ? undefined : value.values;
    const cacheKey = values ? key + JSON.stringify(values) : key;
    if (cacheKey !== this.lastKey) {
      this.lastKey = cacheKey;
      this.subscription?.unsubscribe();
      // markForCheck is what keeps an OnPush view in sync: the pipe is impure,
      // so it only re-runs while its view is being checked.
      this.subscription = this.translate
        .selectTranslate<string>(key, values)
        .subscribe((translation) => {
          this.lastValue = translation;
          this.cdr.markForCheck();
        });
    }
    return this.lastValue;
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }
}

import { Pipe, PipeTransform } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { TString } from '../models/translatable-string';

@Pipe({
  name: 'tsTranslate',
  pure: false,
  standalone: false,
})
export class TStringTranslatePipe implements PipeTransform {
  constructor(private translate: TranslocoService) {}

  transform(value?: TString): unknown {
    if (!value) return '';
    if (typeof value === 'string') {
      return this.translate.translate(value);
    }
    return this.translate.translate(value.string, value.values);
  }
}

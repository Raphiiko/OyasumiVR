import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { TString } from '../models/translatable-string';

@Pipe({
  name: 'tsTranslate',
  pure: false,
})
export class TStringTranslatePipePipe implements PipeTransform {
  constructor(private translate: TranslateService) {}

  transform(value?: TString): unknown {
    if (!value) return '';
    if (typeof value === 'string') {
      return this.translate.instant(value);
    }
    return this.translate.instant(value.string, value.values);
  }
}

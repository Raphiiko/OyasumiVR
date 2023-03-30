import { DatePipe } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { NG_LOCALE_MAP } from '../globals';

@Pipe({
  name: 'localizedDate',
  pure: false,
})
export class LocalizedDatePipe implements PipeTransform {
  constructor(private translateService: TranslateService) {}

  transform(value: any, pattern = 'mediumDate'): any {
    const datePipe: DatePipe = new DatePipe(NG_LOCALE_MAP[this.translateService.currentLang]);
    return datePipe.transform(value, pattern);
  }
}

import { DatePipe } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { NG_LOCALE_MAP } from '../globals';

@Pipe({
    name: 'localizedDate',
    pure: false,
    standalone: false
})
export class LocalizedDatePipe implements PipeTransform {
  constructor(private translateService: TranslateService) {}

  transform(value: any, pattern = 'mediumDate'): any {
    let currentLang = this.translateService.currentLang;
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

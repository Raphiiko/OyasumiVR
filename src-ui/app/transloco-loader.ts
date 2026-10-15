import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private http = inject(HttpClient);

  getTranslation(lang: string) {
    // DEBUG lives only in memory: a failed load makes Transloco pipes stop updating
    if (lang === 'DEBUG') return of({});
    return this.http.get<Translation>(`./assets/i18n/${lang}.json`);
  }
}

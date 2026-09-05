import { inject, Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { IpcService } from '../ipc/ipc.service';
import { DEBUG_LOCALE, FALLBACK_LOCALE, LOCALE_LOADERS } from './locales';

@Injectable({ providedIn: 'root' })
export class OverlayTranslocoLoader implements TranslocoLoader {
  private readonly ipc = inject(IpcService);

  async getTranslation(lang: string): Promise<Translation> {
    if (lang === DEBUG_LOCALE) {
      return (await this.ipc.getDebugTranslations()) ?? this.load(FALLBACK_LOCALE);
    }
    return this.load(lang);
  }

  private async load(lang: string): Promise<Translation> {
    const loader = LOCALE_LOADERS[lang] ?? LOCALE_LOADERS[FALLBACK_LOCALE];
    return (await loader()).default;
  }
}

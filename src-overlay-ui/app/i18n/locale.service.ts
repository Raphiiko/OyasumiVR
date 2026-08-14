import { effect, inject, Injectable, Injector } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { fontLoader } from 'src-shared-ts/src/font-loader';
import { IpcService } from '../ipc/ipc.service';
import { FALLBACK_LOCALE } from './locales';

/** Keeps the active Transloco language and the loaded fonts in sync with the locale the core reports. */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly ipc = inject(IpcService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private activeLocale?: string;

  async init(): Promise<void> {
    await this.activate(FALLBACK_LOCALE);
    effect(() => void this.activate(this.ipc.locale()), { injector: this.injector });
  }

  private async activate(locale: string): Promise<void> {
    if (this.activeLocale === locale) return;
    this.activeLocale = locale;
    await Promise.all([
      fontLoader.loadFontsForNewLocale(locale),
      firstValueFrom(this.transloco.load(locale)),
    ]);
    this.transloco.setActiveLang(locale);
  }
}

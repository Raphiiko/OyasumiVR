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
  private requestedLocale?: string;

  async init(): Promise<void> {
    await this.activate(FALLBACK_LOCALE);
    effect(() => void this.activate(this.ipc.locale()), { injector: this.injector });
  }

  private async activate(locale: string): Promise<void> {
    if (this.requestedLocale === locale) return;
    this.requestedLocale = locale;
    // A font the core cannot serve must not keep the UI in the previous language.
    const fonts = fontLoader.loadFontsForNewLocale(locale).catch(() => undefined);
    try {
      await Promise.all([fonts, firstValueFrom(this.transloco.load(locale))]);
    } catch (e) {
      // Let a later request for this locale try again, without disowning a newer one.
      if (this.requestedLocale === locale) this.requestedLocale = undefined;
      console.error(`Could not load translations for locale "${locale}"`, e);
      return;
    }
    // Skip if a newer locale arrived while this one was loading.
    if (this.requestedLocale === locale) this.transloco.setActiveLang(locale);
  }
}

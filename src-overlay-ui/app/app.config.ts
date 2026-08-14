import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideTransloco, TRANSLOCO_TRANSPILER } from '@jsverse/transloco';
import { fontLoader } from 'src-shared-ts/src/font-loader';
import { AVAILABLE_LOCALES, FALLBACK_LOCALE } from './i18n/locales';
import { LocaleService } from './i18n/locale.service';
import { OverlayTranslocoLoader } from './i18n/overlay-transloco-loader';
import { SafeMessageFormatTranspiler } from './i18n/safe-message-format-transpiler';
import { IpcService } from './ipc/ipc.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideTransloco({
      config: {
        availableLangs: AVAILABLE_LOCALES,
        defaultLang: FALLBACK_LOCALE,
        fallbackLang: FALLBACK_LOCALE,
        missingHandler: { useFallbackTranslation: true },
        reRenderOnLangChange: true,
        prodMode: false,
      },
      loader: OverlayTranslocoLoader,
    }),
    { provide: TRANSLOCO_TRANSPILER, useClass: SafeMessageFormatTranspiler },
    provideAppInitializer(async () => {
      const ipc = inject(IpcService);
      const locales = inject(LocaleService);
      initFonts();
      ipc.init();
      await ipc.initOutgoingIpc();
      await locales.init();
    }),
  ],
};

/** Fonts are served by the core, so a browser opened without a `corePort` renders unstyled text. */
function initFonts(): void {
  const corePort = parseInt(new URLSearchParams(window.location.search).get('corePort') ?? '0', 10);
  if (corePort > 0 && corePort < 65536) fontLoader.init(corePort);
}

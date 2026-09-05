import { enableProdMode, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { platformBrowser } from '@angular/platform-browser';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { attachConsole, error, info } from '@tauri-apps/plugin-log';
import { getVersion } from './app/utils/app-utils';
import { FLAVOUR } from './build';
import { disableDefaultContextMenu } from './app/utils/browser-utils';
import { initCnCompliance } from './app/cn-compliance';

if (environment.production) {
  enableProdMode();
}

if (isDevMode()) {
  attachConsole();
}

getVersion().then((version) => {
  info('[Oyasumi] Starting OyasumiVR v' + version + '-' + FLAVOUR);
});

disableDefaultContextMenu();

initCnCompliance()
  .catch((err) => error(err))
  .then(() =>
    platformBrowser()
      .bootstrapModule(AppModule, { applicationProviders: [provideZoneChangeDetection()] })
      .catch((err) => error(err))
  );

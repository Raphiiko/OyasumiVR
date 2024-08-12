import { enableProdMode, isDevMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { attachConsole, error, info } from 'tauri-plugin-log-api';
import { getVersion } from './app/utils/app-utils';
import { FLAVOUR } from './build';
import { disableDefaultContextMenu } from './app/utils/browser-utils';

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

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch((err) => error(err));

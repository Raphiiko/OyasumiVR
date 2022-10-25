import { enableProdMode, isDevMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import { attachConsole, error } from 'tauri-plugin-log-api';

if (environment.production) {
  enableProdMode();
}

if (isDevMode()) {
  attachConsole();
}

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch((err) => error(err));

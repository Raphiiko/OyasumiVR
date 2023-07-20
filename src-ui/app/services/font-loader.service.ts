import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { fontLoader } from 'src-shared-ts/src/font-loader';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class FontLoaderService {
  httpServerPort = 0;

  constructor(private translate: TranslateService) {}

  async init() {
    // Fetch http server port until it's available
    while (!this.httpServerPort) {
      this.httpServerPort = (await invoke<number>('get_http_server_port')) || 0;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Initialize font loader
    fontLoader.init(this.httpServerPort, this.translate.currentLang).then(() => {
      // Load fonts for new locale
      this.translate.onLangChange.subscribe(async (event) => {
        await fontLoader.loadFontsForNewLocale(event.lang);
      });
    });
  }
}

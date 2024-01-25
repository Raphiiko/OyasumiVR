import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { fontLoader } from 'src-shared-ts/src/font-loader';
import { TranslateService } from '@ngx-translate/core';

@Injectable({
  providedIn: 'root',
})
export class FontLoaderService {
  private _httpServerPort = 0;
  public get httpServerPort() {
    return this._httpServerPort;
  }

  constructor(private translate: TranslateService) {}

  async init() {
    // Fetch http server port until it's available
    while (!this._httpServerPort) {
      this._httpServerPort = (await invoke<number>('get_http_server_port')) || 0;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Initialize font loader
    fontLoader.init(this._httpServerPort, this.translate.currentLang).then(() => {
      // Load fonts for new locale
      this.translate.onLangChange.subscribe(async (event) => {
        await fontLoader.loadFontsForNewLocale(event.lang);
      });
    });
  }
}

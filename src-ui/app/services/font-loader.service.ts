import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { fontLoader } from 'src-shared-ts/src/font-loader';
import { TranslocoService } from '@jsverse/transloco';

@Injectable({
  providedIn: 'root',
})
export class FontLoaderService {
  private _httpServerPort = 0;
  public get httpServerPort() {
    return this._httpServerPort;
  }

  constructor(private translate: TranslocoService) {}

  async init() {
    // Fetch http server port until it's available
    while (!this._httpServerPort) {
      this._httpServerPort = (await invoke<number>('get_http_server_port')) || 0;
      if (!this._httpServerPort) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Initialize font loader
    fontLoader.init(this._httpServerPort, this.translate.getActiveLang()!).then(() => {
      // Load fonts for new locale
      this.translate.langChanges$.subscribe(async (lang) => {
        await fontLoader.loadFontsForNewLocale(lang);
      });
    });
  }
}

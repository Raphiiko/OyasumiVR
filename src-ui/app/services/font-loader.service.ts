import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { flattenDeep } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class FontLoaderService {
  httpServerPort = 0;

  constructor() {}

  async init() {
    // Fetch http server port until it's available
    while (!this.httpServerPort) {
      this.httpServerPort = (await invoke<number>('get_http_server_port')) || 0;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await this.loadFonts();
  }

  async loadFonts() {
    const fontDefs: Array<{
      family: string;
      sets: string[];
      weights: number[];
      variants: string[];
    }> = [
      {
        family: 'Poppins',
        sets: ['latin', 'latin-ext'],
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        variants: ['normal', 'italic'],
      },
      {
        family: 'Noto Sans JP',
        sets: ['japanese'],
        weights: [100, 300, 400, 500, 700, 900],
        variants: ['normal'],
      },
      {
        family: 'Noto Sans KR',
        sets: ['korean'],
        weights: [100, 300, 400, 500, 700, 900],
        variants: ['normal'],
      },
      {
        family: 'Noto Sans TC',
        sets: ['chinese-traditional'],
        weights: [100, 300, 400, 500, 700, 900],
        variants: ['normal'],
      },
      {
        family: 'Noto Sans SC',
        sets: ['chinese-simplified'],
        weights: [100, 300, 400, 500, 700, 900],
        variants: ['normal'],
      },
    ];
    let loads = flattenDeep<Promise<FontFace>>(
      fontDefs.map((fontDef) => {
        return fontDef.sets.map((set) => {
          return fontDef.weights.map((weight) => {
            return fontDef.variants.map((variant) => {
              const fileName = `${fontDef.family
                .toLowerCase()
                .replace(/\s+/g, '-')}-${set}-${weight}-${variant}.woff2`;
              const font = new FontFace(
                fontDef.family,
                `url(http://localhost:${this.httpServerPort}/font/${fileName})`,
                {
                  style: variant === 'italic' ? 'italic' : 'normal',
                  weight: weight.toString(),
                }
              );
              (document.fonts as any).add(font);
              return font.load();
            });
          });
        });
      })
    );
    await Promise.all(loads);
  }
}

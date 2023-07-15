import _ from 'lodash';

const { flattenDeep } = _;

interface FontDefinition {
  family: string;
  sets: string[];
  weights: number[];
  variants: string[];
}

class FontLoader {
  private activeLocale?: string;
  private coreHttpPort = 0;

  public async init(coreHttpPort: number, locale: string = 'en') {
    if (!this.activeLocale || locale !== 'en') {
      this.activeLocale = locale;
    }
    if (coreHttpPort <= 0 || coreHttpPort > 65535) return;
    this.coreHttpPort = coreHttpPort;
    const fontDefs: Array<FontDefinition> = [
      {
        family: 'Poppins',
        sets: ['latin', 'latin-ext'],
        weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        variants: ['normal', 'italic'],
      },
      ...this.getExtraFontDefinitionsForLocale(this.activeLocale),
    ];
    await this.loadFonts(fontDefs);
    console.log('All fonts loaded!');
  }

  public async loadFontsForNewLocale(locale: string) {
    this.activeLocale = locale;
    if (this.coreHttpPort <= 0 || this.coreHttpPort > 65535) return;
    const fontDefs: Array<FontDefinition> = this.getExtraFontDefinitionsForLocale(
      this.activeLocale
    );
    await this.loadFonts(fontDefs);
  }

  private async loadFonts(fontDefs: Array<FontDefinition>) {
    const loads = flattenDeep<Promise<FontFace>>(
      fontDefs.map((fontDef) => {
        return fontDef.sets.map((set) => {
          return fontDef.weights.map((weight) => {
            return fontDef.variants.map((variant) => {
              const fileName = `${fontDef.family
                .toLowerCase()
                .replace(/\s+/g, '-')}-${set}-${weight}-${variant}.woff2`;
              const fontUrl = `http://localhost:${this.coreHttpPort}/font/${fileName}`;
              const font = new FontFace(fontDef.family, `url(${fontUrl})`, {
                style: variant === 'italic' ? 'italic' : 'normal',
                weight: weight.toString(),
              });
              (document.fonts as any).add(font);
              return font.load();
            });
          });
        });
      })
    );
    await Promise.all(loads);
  }

  private getExtraFontDefinitionsForLocale(locale: string) {
    const extraFontDefinitions: { [locale: string]: Array<FontDefinition> } = {
      ja: [
        {
          family: 'Noto Sans JP',
          sets: ['japanese'],
          weights: [100, 300, 400, 500, 700, 900],
          variants: ['normal'],
        },
      ],
      ko: [
        {
          family: 'Noto Sans KR',
          sets: ['korean'],
          weights: [100, 300, 400, 500, 700, 900],
          variants: ['normal'],
        },
      ],
      tw: [
        {
          family: 'Noto Sans TC',
          sets: ['chinese-traditional'],
          weights: [100, 300, 400, 500, 700, 900],
          variants: ['normal'],
        },
      ],
      cn: [
        {
          family: 'Noto Sans SC',
          sets: ['chinese-simplified'],
          weights: [100, 300, 400, 500, 700, 900],
          variants: ['normal'],
        },
      ],
    };
    return extraFontDefinitions[locale] ?? [];
  }
}

export const fontLoader = new FontLoader();

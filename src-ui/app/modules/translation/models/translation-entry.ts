export interface TranslationEntry {
  key: string;
  values: {
    [locale: string]: string;
  };
}

export type TranslationEntries = TranslationEntry[];

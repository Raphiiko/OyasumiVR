import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TranslationEntries, TranslationEntry } from '../models/translation-entry';
import { DownloadableTranslation } from '../models/downloadable-translation';
import { Router } from '@angular/router';
import { TranslationEditUtils } from '../utils/translation-edit-utils';
import { message, save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { TranslationSuggestion } from '../models/translation-suggestion';

@Injectable({
  providedIn: 'root',
})
export class TranslationEditService {
  private readonly _entries = new BehaviorSubject<TranslationEntries | null>(null);
  public readonly entries = this._entries.asObservable();
  private readonly _editLocale = new BehaviorSubject<string | null>(null);
  public readonly editLocale = this._editLocale.asObservable();
  private readonly _suggestions = new BehaviorSubject<TranslationSuggestion[]>([]);
  public readonly suggestions = this._suggestions.asObservable();

  constructor(private router: Router) {}

  public async getDownloadableTranslations(): Promise<DownloadableTranslation[]> {
    const response: any = await fetch(
      'https://api.github.com/repos/Raphiiko/OyasumiVR/git/trees/develop?recursive=1'
    ).then((res) => res.json());
    return response['tree']
      .map((file: any) => file.path)
      .filter((path: string) => path.match(/i18n\/[a-zA-Z]+\.json/g))
      .map((path: string) => path.split('/'))
      .map((split: string[]) => split[split.length - 1].split('.')[0])
      .map((locale: string) => ({
        locale,
        url: `https://raw.githubusercontent.com/Raphiiko/OyasumiVR/develop/src-ui/assets/i18n/${locale}.json`,
      }));
  }

  async openEditor(locale: string, enTranslations: any, langTranslations: any) {
    const flatEn = TranslationEditUtils.flatten(enTranslations);
    const flatLang = TranslationEditUtils.flatten(langTranslations);
    let entries = Object.keys(flatEn).map(
      (key) =>
        ({
          key,
          values: {
            en: flatEn[key],
            [locale]: flatLang[key],
          },
        } as TranslationEntry)
    );
    const importCount = entries.filter((e) => e.values[locale] !== undefined).length;
    const discarded = Object.keys(flatLang).length - importCount;
    if (discarded > 0) {
      message(
        `Discarded ${discarded} translation(s) because they were not present in the English translation file.`
      );
    }
    // Remove empty and placeholder entries
    entries = entries.filter((e) => {
      let trimmed = (e.values[locale] ?? '').trim();
      return trimmed && trimmed !== '{PLACEHOLDER}';
    });
    entries.sort((a, b) => a.key.localeCompare(b.key));
    this._editLocale.next(locale);
    this._entries.next(entries);
    await this.router.navigate(['translation', 'editor']);
  }

  reset() {
    this._entries.next(null);
    this._editLocale.next(null);
    this._suggestions.next([]);
  }

  updateEntryValue(key: string, locale: string, value: any) {
    const entry = this._entries.value?.find((e) => e.key === key);
    if (!entry) return;
    entry.values[locale] = value;
  }

  async determineSuggestions(locale: string) {
    if (!this._entries.value) return;
    const entries = this._entries.value;
    const suggestions = entries
      .filter((e) => !(e.values[locale] ?? '').trim())
      .map((entry) => this.getSuggestionForEntry(entries, entry, locale))
      .filter(Boolean) as TranslationSuggestion[];
    this._suggestions.next(suggestions);
    return suggestions;
  }

  getSuggestionForEntry(
    entries: TranslationEntries,
    entry: TranslationEntry,
    locale: string
  ): TranslationSuggestion | null {
    const enValue = entry.values['en'];
    const similarEntries = entries.filter((e) => e.values['en'] === enValue);
    const similarValues = similarEntries.map((e) => e.values[locale]);
    const stringCount: Record<string, number> = {};
    let mostFrequentValue: string | null = null;
    let maxCount = 0;
    similarValues.forEach((str) => {
      if (stringCount[str]) {
        stringCount[str]++;
      } else {
        stringCount[str] = 1;
      }

      if (stringCount[str] > maxCount) {
        maxCount = stringCount[str];
        mostFrequentValue = str;
      }
    });
    return mostFrequentValue ? { key: entry.key, value: mostFrequentValue, locale } : null;
  }

  async saveToFile(locale: string): Promise<boolean> {
    if (!this._entries.value) return false;
    const flattened = this._entries.value.reduce((acc: any, e) => {
      if (e.values[locale] !== undefined) {
        acc[e.key] = e.values[locale].trim();
      }
      return acc;
    }, {});
    const unflattened = TranslationEditUtils.unflatten(flattened);
    const stringdata = JSON.stringify(unflattened, null, 2);
    const filePath = await save({
      defaultPath: locale + '.json',
      filters: [
        {
          name: 'Translation File',
          extensions: ['json'],
        },
      ],
    });
    if (!filePath) return false;
    try {
      await writeTextFile(filePath!, stringdata);
    } catch (e) {
      await message('The translation file could not be saved:\n' + e);
      return false;
    }
    return true;
  }

  async updateTranslations(): Promise<{
    added: number;
    removed: number;
    keysRemoved: number;
  } | null> {
    if (!this._entries.value) return null;
    const translations = this._entries.value!;
    const locales = translations.reduce((acc, e) => {
      Object.keys(e.values).forEach((l) => {
        if (!acc.includes(l)) acc.push(l);
      });
      return acc;
    }, [] as string[]);
    if (!locales.includes('en')) locales.push('en');
    const newTranslations: { [locale: string]: { [key: string]: string } } = {};
    try {
      let downloadableTranslations = await this.getDownloadableTranslations();
      downloadableTranslations = locales
        .map((l) => downloadableTranslations.find((dt) => dt.locale === l))
        .filter(Boolean) as DownloadableTranslation[];
      for (const dt of downloadableTranslations) {
        newTranslations[dt.locale] = TranslationEditUtils.flatten(
          await fetch(dt.url).then((resp) => resp.json())
        ) as { [key: string]: string };
      }
    } catch (e) {
      await message(
        'Could not download updated translations to update your current translations:\n' + e
      );
      return null;
    }
    // Add new translations
    const enTranslations = newTranslations['en'];
    let added = 0;
    Object.entries(enTranslations).forEach(([key, enValue]) => {
      if (enValue && !translations.some((t) => t.key === key)) {
        const translation = {
          key,
          values: {} as { [key: string]: string },
        };
        Object.entries(newTranslations).forEach(([locale, translations]) => {
          if (translations[key]) {
            translation.values[locale] = translations[key];
          }
        });
        added++;
        translations.push(translation);
      }
    });
    // Remove translations that are not present in the new translations
    let removed = 0;
    translations.forEach((translation) => {
      Object.entries(translation.values)
        .filter(([, value]) => value)
        .forEach(([locale]) => {
          if (!newTranslations[locale]?.[translation.key]) {
            delete translation.values[locale];
            removed++;
          }
        });
    });
    // Remove translations that have no EN translation anymore
    let keysRemoved = 0;
    const t = translations.filter((t) => {
      const keep = !!enTranslations[t.key];
      if (!keep) keysRemoved++;
      return keep;
    });
    translations.splice(0, translations.length, ...t);

    return {
      added,
      removed,
      keysRemoved,
    };
  }
}

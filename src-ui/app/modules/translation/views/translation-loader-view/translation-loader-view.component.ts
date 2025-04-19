import { Component } from '@angular/core';
import { TranslationEditService } from '../../services/translation-edit.service';
import { DownloadableTranslation } from '../../models/downloadable-translation';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { error } from '@tauri-apps/plugin-log';
import { message, open as openFile } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { Router } from '@angular/router';

@Component({
  selector: 'app-translation-loader-view',
  templateUrl: './translation-loader-view.component.html',
  styleUrls: ['./translation-loader-view.component.scss'],
  standalone: false,
})
export class TranslationLoaderViewComponent {
  protected state: 'INITIALIZING' | 'INITIALIZED' | 'ERROR' | 'STARTING' = 'INITIALIZING';
  protected error?: string;
  protected downloadableTranslations: DownloadableTranslation[] = [];
  protected translationOptions: SelectBoxItem[] = [];
  protected translationOption?: SelectBoxItem;
  protected languageCode = '';

  get hasValidLanguageCode(): boolean {
    return this.languageCode.trim().length === 2 && !!this.languageCode.trim().match(/[a-zA-Z]{2}/);
  }

  constructor(private translationEditService: TranslationEditService, private router: Router) {
    this.init();
  }

  async init() {
    this.error = undefined;
    try {
      this.downloadableTranslations =
        await this.translationEditService.getDownloadableTranslations();
      this.translationOptions = this.downloadableTranslations
        .filter((t) => t.locale !== 'en')
        .map(
          (t) =>
            ({
              id: t.locale,
              label: t.locale,
            } as SelectBoxItem)
        );
      this.state = 'INITIALIZED';
    } catch (e) {
      console.log(e);
      error('Could not fetch downloadable translations: ' + e);
      this.state = 'ERROR';
      this.error =
        'The translation editor could not be initialized. Please ensure you have an internet connection and/or retry at a later time. Please submit an issue report if this keeps happening.';
    }
  }

  async downloadForExistingLanguage() {
    const dt = this.downloadableTranslations.find((t) => t.locale === this.translationOption!.id);
    const locale = dt!.locale.toLowerCase().trim();
    this.state = 'STARTING';
    const enTranslations = await this.loadTranslationsFromUrl(
      this.downloadableTranslations.find((dt) => dt.locale === 'en')!.url
    );
    if (!enTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    const langTranslations = await this.loadTranslationsFromUrl(dt!.url);
    if (!langTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    await this.translationEditService.openEditor(locale, enTranslations, langTranslations);
  }

  async openForExistingLanguage() {
    const locale = this.translationOption!.id.toLowerCase().trim();
    this.state = 'STARTING';
    const enTranslations = await this.loadTranslationsFromUrl(
      this.downloadableTranslations.find((dt) => dt.locale === 'en')!.url
    );
    if (!enTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    const langTranslations = await this.loadTranslationsFromFile();
    if (!langTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    await this.translationEditService.openEditor(locale, enTranslations, langTranslations);
  }

  async startNewLanguage() {
    const locale = this.languageCode.toLowerCase().trim();
    this.state = 'STARTING';
    const enTranslations = await this.loadTranslationsFromUrl(
      this.downloadableTranslations.find((dt) => dt.locale === 'en')!.url
    );
    if (!enTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    const langTranslations: any = {};
    await this.translationEditService.openEditor(locale, enTranslations, langTranslations);
  }

  async openForNewLanguage() {
    const locale = this.languageCode.toLowerCase().trim();
    this.state = 'STARTING';
    const enTranslations = await this.loadTranslationsFromUrl(
      this.downloadableTranslations.find((dt) => dt.locale === 'en')!.url
    );
    if (!enTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    const langTranslations = await this.loadTranslationsFromFile();
    if (!langTranslations) {
      this.state = 'INITIALIZED';
      return;
    }
    await this.translationEditService.openEditor(locale, enTranslations, langTranslations);
  }

  async loadTranslationsFromUrl(url: string): Promise<any | null> {
    let translations: any;
    try {
      translations = await fetch(url).then((data) => data.json());
    } catch (e) {
      error(`Could not load translations from url: ${JSON.stringify(e)}`);
      await message('Translations could not be loaded:\n' + e, {
        title: 'Error loading translations',
        kind: 'error',
      });
      return;
    }
    return translations;
  }

  async loadTranslationsFromFile(): Promise<any | null> {
    const path = await openFile({
      directory: false,
      multiple: false,
      filters: [
        {
          name: 'Translation File',
          extensions: ['json'],
        },
      ],
    });
    if (typeof path !== 'string') return;
    let translations;
    try {
      const fileData = await readTextFile(path);
      translations = JSON.parse(fileData);
    } catch (e) {
      error(`Could not load translations from file: ${JSON.stringify(e)}`);
      await message('Translations could not be loaded:\n' + e, {
        title: 'Error loading translations',
        kind: 'error',
      });
      return null;
    }
    return translations;
  }

  closeTranslationModule() {
    this.router.navigate(['']);
  }
}

import { Component } from '@angular/core';
import { TranslationEditService } from '../../services/translation-edit.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslationEntry } from '../../models/translation-entry';
import { Router } from '@angular/router';
import { ModalService } from '../../../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../components/confirm-modal/confirm-modal.component';
import { combineLatest, debounceTime, firstValueFrom, Subject } from 'rxjs';
import { message } from '@tauri-apps/api/dialog';
import { TranslationSuggestion } from '../../models/translation-suggestion';
import { vshrink } from '../../../../utils/animations';

interface TranslationRowEntry {
  key: string;
  htmlKey: string;
  values: {
    en: string;
    [locale: string]: string;
  };
  suggestion?: string;
}

@Component({
  selector: 'app-translation-editor-view',
  templateUrl: './translation-editor-view.component.html',
  styleUrls: ['./translation-editor-view.component.scss'],
  animations: [vshrink()],
})
export class TranslationEditorViewComponent {
  protected entries: TranslationRowEntry[] = [];
  protected locale?: string;
  protected changesMade = false;
  protected entriesTranslated = 0;
  protected entriesTranslatedPercentage = 100;
  protected changeMade = new Subject<void>();

  constructor(
    private translationEditService: TranslationEditService,
    private router: Router,
    private modalService: ModalService
  ) {
    this.translationEditService.editLocale.pipe(takeUntilDestroyed()).subscribe((locale) => {
      if (!locale) {
        this.router.navigate(['translation', 'loader']);
        return;
      }
      this.locale = locale;
    });
    combineLatest([this.translationEditService.entries, this.translationEditService.suggestions])
      .pipe(takeUntilDestroyed(), debounceTime(0))
      .subscribe(([entries, suggestions]) => this.processEntryChanges(entries, suggestions));
    this.changeMade.pipe(takeUntilDestroyed(), debounceTime(500)).subscribe(() => {
      this.calculateKeysTranslated();
    });
  }

  private async processEntryChanges(
    entries: TranslationEntry[] | null,
    suggestions: TranslationSuggestion[]
  ) {
    if (!entries) {
      this.entries = [];
      return;
    }
    if (!this.locale) return;
    for (const entry of entries) {
      const index = this.entries.findIndex((e) => e.key === entry.key);
      if (index === -1) {
        this.entries.push({
          key: entry.key,
          htmlKey: entry.key.split('.').join('<wbr>.'),
          values: {
            en: entry.values['en'],
            [this.locale ?? '']: entry.values[this.locale ?? ''] ?? '',
          },
          suggestion: suggestions.find((s) => s.key === entry.key)?.value,
        });
      } else {
        const rowEntry = this.entries[index];
        Object.assign(rowEntry.values, entry.values);
        rowEntry.suggestion = suggestions.find((s) => s.key === entry.key)?.value;
      }
    }
    // Remove entries that are not present in the new entries, in place
    let index;
    while ((index = this.entries.findIndex((e) => !entries.some((_e) => _e.key === e.key))) > -1) {
      this.entries.splice(index, 1);
    }
    // Sort the rows
    this.entries.sort((a: TranslationRowEntry, b: TranslationRowEntry): number => {
      // First, compare by the presence of suggestion (ascending order)
      if (a.suggestion && !b.suggestion) {
        return -1;
      } else if (!a.suggestion && b.suggestion) {
        return 1;
      }

      // Then, compare by the truthiness of the current locale (descending order)
      const aLocaleValue = a.values[this.locale!];
      const bLocaleValue = b.values[this.locale!];

      if (aLocaleValue && !bLocaleValue) {
        return 1;
      } else if (!aLocaleValue && bLocaleValue) {
        return -1;
      }

      // Finally, compare alphabetically by the key
      return a.key.localeCompare(b.key);
    });

    this.changeMade.next();
  }

  async closeEditor() {
    if (this.changesMade) {
      const result = await firstValueFrom(
        this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
          ConfirmModalComponent,
          {
            title: 'Are you sure?',
            message:
              'You might have some unsaved changes that could be lost. Make sure you have exported your translations file before closing the editor.',
            confirmButtonText: 'Yes, Close',
            cancelButtonText: 'No, Stay',
          }
        )
      );
      if (!result.confirmed) return;
    }
    this.entries = [];
    this.translationEditService.reset();
    await this.router.navigate(['translation', 'loader']);
  }

  onTranslationChange(entry: TranslationRowEntry, locale: string, value: any) {
    entry.values[locale] = value;
    this.translationEditService.updateEntryValue(entry.key, locale, value);
    this.changesMade = true;
    this.changeMade.next();
  }

  async export() {
    if (!this.locale) return;
    if (await this.translationEditService.saveToFile(this.locale)) {
      this.changesMade = false;
    }
  }

  async updateTranslations() {
    const result = await this.translationEditService.updateTranslations();
    if (!result) return;
    await message(
      'Your translations have been updated!\n\nIn total, ' +
        result.added +
        ' translation(s) were added and ' +
        result.keysRemoved +
        ' translation(s) were removed.'
    );
  }

  async checkForSuggestions() {
    if (!this.locale) return;
    const suggestions = await this.translationEditService.determineSuggestions(this.locale);
    if (suggestions && suggestions.length) {
      message(suggestions.length + ' suggestion(s) have been found!');
    } else {
      message('No suggestions have been found.');
    }
  }

  applySuggestion(entry: TranslationRowEntry) {
    if (!this.locale || !entry.suggestion) return;
    this.onTranslationChange(entry, this.locale, entry.suggestion);
    entry.suggestion = undefined;
  }

  discardSuggestion(entry: TranslationRowEntry) {
    entry.suggestion = undefined;
  }

  calculateKeysTranslated() {
    if (!this.locale) return;
    const entries = (this.entries || []).length;
    this.entriesTranslated = (this.entries || []).filter((e) => {
      return !!(e.values[this.locale!] ?? '').trim();
    }).length;
    this.entriesTranslatedPercentage = Math.floor((this.entriesTranslated / entries) * 100);
  }
}

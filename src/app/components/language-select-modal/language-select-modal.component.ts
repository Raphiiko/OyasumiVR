import { Component } from '@angular/core';
import { fadeUp } from '../../utils/animations';
import { BaseModalComponent } from 'src/app/components/base-modal/base-modal.component';
import { LANGUAGES } from 'src/app/globals';
import { AppSettingsService } from '../../services/app-settings.service';

@Component({
  selector: 'app-language-select-modal',
  templateUrl: './language-select-modal.component.html',
  styleUrls: ['./language-select-modal.component.scss'],
  animations: [fadeUp()],
})
export class LanguageSelectModalComponent extends BaseModalComponent<void, void> {
  languages = LANGUAGES;

  constructor(private settingsService: AppSettingsService) {
    super();
  }

  async selectLanguage(language: { code: string; label: string; flag?: string }) {
    this.settingsService.updateSettings({ userLanguage: language.code });
    await this.close();
  }
}

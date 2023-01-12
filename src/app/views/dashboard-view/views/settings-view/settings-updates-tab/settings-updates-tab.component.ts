import { Component } from '@angular/core';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { getVersion } from '../../../../../utils/app-utils';
import { firstValueFrom, takeUntil } from 'rxjs';
import { marked } from 'marked';
import { UpdateService } from '../../../../../services/update.service';
import { HttpClient } from '@angular/common/http';
import { hshrink } from '../../../../../utils/animations';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-settings-updates-tab',
  templateUrl: './settings-updates-tab.component.html',
  styleUrls: ['./settings-updates-tab.component.scss'],
  animations: [hshrink()],
})
export class SettingsUpdatesTabComponent extends SettingsTabComponent {
  updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  version: string = '';
  changelog: SafeHtml = '';
  updateOrCheckInProgress = false;

  constructor(
    settingsService: AppSettingsService,
    private update: UpdateService,
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
    this.version = await getVersion();
    this.update.updateAvailable.pipe(takeUntil(this.destroy$)).subscribe((available) => {
      this.updateAvailable = available;
    });
    this.changelog = await this.getChangeLog();
  }

  async getChangeLog(): Promise<SafeHtml> {
    let changelog = '';
    try {
      changelog = await firstValueFrom(
        this.http.get('https://raw.githubusercontent.com/Raphiiko/Oyasumi/main/CHANGELOG.md', {
          responseType: 'text',
        })
      );
    } catch (e) {
      changelog = await firstValueFrom(
        this.http.get('/assets/CHANGELOG.md', {
          responseType: 'text',
        })
      );
    }
    let firstIndex = changelog.indexOf('##');
    changelog = changelog.slice(firstIndex, changelog.length);
    changelog = marked.parse(changelog);
    changelog = changelog.replace(/<a /g, '<a target="_blank" ');
    return this.sanitizer.bypassSecurityTrustHtml(changelog);
  }

  async updateOrCheck() {
    if (this.updateOrCheckInProgress) return;
    this.updateOrCheckInProgress = true;
    await Promise.allSettled([
      this.updateAvailable.manifest
        ? this.update.installUpdate()
        : this.update.checkForUpdate(false),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.updateOrCheckInProgress = false;
  }
}

import { Component, DestroyRef, OnInit } from '@angular/core';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { getVersion } from '../../../../../utils/app-utils';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';
import { UpdateService } from '../../../../../services/update.service';
import { HttpClient } from '@angular/common/http';
import { hshrink } from '../../../../../utils/animations';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-settings-updates-tab',
  templateUrl: './settings-updates-tab.component.html',
  styleUrls: ['./settings-updates-tab.component.scss'],
  animations: [hshrink()],
})
export class SettingsUpdatesTabComponent extends SettingsTabComponent implements OnInit {
  updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  version = '';
  changelog: SafeHtml = '';
  updateOrCheckInProgress = false;

  constructor(
    settingsService: AppSettingsService,
    destroyRef: DestroyRef,
    private update: UpdateService,
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
    this.version = await getVersion();
    this.update.updateAvailable.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((available) => {
      this.updateAvailable = available;
    });
    this.changelog = await this.getChangeLog();
  }

  async getChangeLog(): Promise<SafeHtml> {
    let changelog = '';
    try {
      changelog = await firstValueFrom(
        this.http.get('https://raw.githubusercontent.com/Raphiiko/OyasumiVR/main/CHANGELOG.md', {
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
    const firstIndex = changelog.indexOf('##');
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

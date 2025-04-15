import { Component, DestroyRef, OnInit } from '@angular/core';
import { UpdateManifest } from '@tauri-apps/plugin-updater';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FLAVOUR } from 'src-ui/build';
import { hshrink } from 'src-ui/app/utils/animations';
import { UpdateService } from '../../../../services/update.service';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { getVersion } from '../../../../utils/app-utils';

@Component({
    selector: 'app-settings-updates-view',
    templateUrl: './settings-updates-view.component.html',
    styleUrls: ['./settings-updates-view.component.scss'],
    animations: [hshrink()],
    standalone: false
})
export class SettingsUpdatesViewComponent implements OnInit {
  protected updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  protected version = '';
  protected changelog: SafeHtml = '';
  protected updateOrCheckInProgress = false;
  protected FLAVOUR = FLAVOUR;

  constructor(
    private update: UpdateService,
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService
  ) {}

  async ngOnInit() {
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

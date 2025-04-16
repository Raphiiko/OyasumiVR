import { Component, DestroyRef, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FLAVOUR } from 'src-ui/build';
import { hshrink } from 'src-ui/app/utils/animations';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { getVersion } from '../../../../utils/app-utils';

@Component({
  selector: 'app-settings-updates-view',
  templateUrl: './settings-updates-view.component.html',
  styleUrls: ['./settings-updates-view.component.scss'],
  animations: [hshrink()],
  standalone: false,
})
export class SettingsUpdatesViewComponent implements OnInit {
  protected version = '';
  protected changelog: SafeHtml = '';
  protected FLAVOUR = FLAVOUR;

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService
  ) {}

  async ngOnInit() {
    this.version = await getVersion();
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
}

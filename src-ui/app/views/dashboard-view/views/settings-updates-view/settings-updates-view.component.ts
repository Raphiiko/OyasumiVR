import { Component, DestroyRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Update } from '@tauri-apps/plugin-updater';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FLAVOUR } from 'src-ui/build';
import { UpdateService } from '../../../../services/update.service';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { getVersion } from '../../../../utils/app-utils';
import { ChangelogRelease, ChangelogSectionKind, parseChangelog } from './changelog';

type UpdateState =
  'steam' | 'dev' | 'unchecked' | 'checking' | 'upToDate' | 'available' | 'installing';

interface Release extends ChangelogRelease {
  latest: boolean;
}

const SECTION_ICONS: Record<ChangelogSectionKind, string> = {
  added: 'sparkle',
  changed: 'refresh',
  fixed: 'check',
  removed: 'delete',
  other: 'info',
};

@Component({
  selector: 'app-settings-updates-view',
  templateUrl: './settings-updates-view.component.html',
  styleUrls: ['./settings-updates-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsUpdatesViewComponent implements OnInit {
  protected updateAvailable: { checked: boolean; update?: Update } = { checked: false };
  protected version = '';
  protected releases: Release[] = [];
  protected openReleases = new Set<string>();
  protected readonly SECTION_ICONS = SECTION_ICONS;
  protected FLAVOUR = FLAVOUR;
  private requestInProgress = false;

  protected get updateOrCheckInProgress() {
    return this.requestInProgress || this.update.installing();
  }

  protected get updateState(): UpdateState {
    if (this.FLAVOUR === 'STEAM') return 'steam';
    if (this.FLAVOUR === 'DEV') return 'dev';
    if (this.update.installing()) return 'installing';
    if (this.updateAvailable.update) return 'available';
    if (this.requestInProgress) return 'checking';
    return this.updateAvailable.checked ? 'upToDate' : 'unchecked';
  }

  constructor(
    private update: UpdateService,
    private http: HttpClient,
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService
  ) {}

  async ngOnInit() {
    this.version = await getVersion();
    this.update.updateAvailable.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((available) => {
      this.updateAvailable = available;
    });
    this.releases = this.toReleases(parseChangelog(await this.getChangeLog()));
    if (this.releases.length) this.openReleases.add(this.releases[0].version);
  }

  async getChangeLog(): Promise<string> {
    try {
      return await firstValueFrom(
        this.http.get('https://raw.githubusercontent.com/Raphiiko/OyasumiVR/main/CHANGELOG.md', {
          responseType: 'text',
        })
      );
    } catch {
      return await firstValueFrom(this.http.get('/assets/CHANGELOG.md', { responseType: 'text' }));
    }
  }

  async updateOrCheck() {
    if (this.updateOrCheckInProgress) return;
    this.requestInProgress = true;
    await Promise.allSettled([
      this.updateAvailable.update
        ? this.update.installUpdate()
        : this.update.checkForUpdate(false, true),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.requestInProgress = false;
  }

  protected toggleRelease(version: string) {
    if (this.openReleases.has(version)) this.openReleases.delete(version);
    else this.openReleases.add(version);
  }

  private toReleases(releases: ChangelogRelease[]): Release[] {
    const latestVersion = releases.find((r) => !r.unreleased)?.version;
    return releases.map((release) => ({ ...release, latest: release.version === latestVersion }));
  }
}

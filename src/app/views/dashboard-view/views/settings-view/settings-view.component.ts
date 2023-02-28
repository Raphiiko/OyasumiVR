import { Component, OnDestroy, OnInit } from '@angular/core';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import { hshrink, noop } from '../../../../utils/animations';
import { UpdateService } from '../../../../services/update.service';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { ActivatedRoute } from '@angular/router';

type SettingsTab = 'GENERAL' | 'VRCHAT' | 'NOTIFICATIONS' | 'UPDATES' | 'DEBUG';

@Component({
  selector: 'app-settings-view',
  templateUrl: './settings-view.component.html',
  styleUrls: ['./settings-view.component.scss'],
  animations: [noop(), hshrink()],
})
export class SettingsViewComponent implements OnInit, OnDestroy {
  updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  destroy$: Subject<void> = new Subject<void>();
  activeTab: SettingsTab = 'GENERAL';

  constructor(private update: UpdateService, private activatedRoute: ActivatedRoute) {}

  async ngOnInit() {
    this.update.updateAvailable.pipe(takeUntil(this.destroy$)).subscribe((available) => {
      this.updateAvailable = available;
    });
    const fragment = await firstValueFrom(this.activatedRoute.fragment);
    if (fragment) this.activeTab = fragment as SettingsTab;
  }

  ngOnDestroy() {
    this.destroy$.next();
  }
}

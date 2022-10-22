import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { hshrink, noop } from '../../../../utils/animations';
import { UpdateService } from '../../../../services/update.service';
import { UpdateManifest } from '@tauri-apps/api/updater';

@Component({
  selector: 'app-settings-view',
  templateUrl: './settings-view.component.html',
  styleUrls: ['./settings-view.component.scss'],
  animations: [noop(), hshrink()],
})
export class SettingsViewComponent implements OnInit, OnDestroy {
  updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  destroy$: Subject<void> = new Subject<void>();
  activeTab: 'GENERAL' | 'VRCHAT' | 'UPDATES' | 'DEBUG' = 'GENERAL';

  constructor(private update: UpdateService) {}

  async ngOnInit() {
    this.update.updateAvailable.pipe(takeUntil(this.destroy$)).subscribe((available) => {
      this.updateAvailable = available;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }
}

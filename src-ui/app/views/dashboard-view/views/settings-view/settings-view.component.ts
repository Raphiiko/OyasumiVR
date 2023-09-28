import { Component, DestroyRef, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { hshrink, noop } from '../../../../utils/animations';
import { UpdateService } from '../../../../services/update.service';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { ActivatedRoute } from '@angular/router';
import { OscService } from '../../../../services/osc.service';
import { flatten } from 'lodash';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type SettingsTab = 'GENERAL' | 'VRCHAT' | 'NOTIFICATIONS' | 'UPDATES' | 'INTEGRATIONS' | 'ADVANCED';

@Component({
  selector: 'app-settings-view',
  templateUrl: './settings-view.component.html',
  styleUrls: ['./settings-view.component.scss'],
  animations: [noop(), hshrink()],
})
export class SettingsViewComponent implements OnInit {
  updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  activeTab: SettingsTab = 'GENERAL';
  oscError = false;
  constructor(
    private update: UpdateService,
    private activatedRoute: ActivatedRoute,
    private osc: OscService,
    private destroyRef: DestroyRef
  ) {}

  async ngOnInit() {
    this.update.updateAvailable.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((available) => {
      this.updateAvailable = available;
    });
    this.osc.addressValidation.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((validation) => {
      this.oscError = flatten(Object.values(validation)).length > 0;
    });
    const fragment = await firstValueFrom(this.activatedRoute.fragment);
    if (fragment) this.activeTab = fragment as SettingsTab;
  }
}

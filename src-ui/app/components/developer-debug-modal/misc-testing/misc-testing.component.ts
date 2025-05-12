import { Component, Input, OnInit } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { OpenVRService } from '../../../services/openvr.service';
import { firstValueFrom, take } from 'rxjs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { AppSettingsService } from '../../../services/app-settings.service';
import { sleep } from '../../../utils/promise-utils';
import { invoke } from '@tauri-apps/api/core';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent implements OnInit {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(private openvr: OpenVRService, protected appSettings: AppSettingsService) {
  }

  ngOnInit(): void {
  }

  result: any = null;
  ovrData: any = {};

  async pullOvrData() {
    this.ovrData = await firstValueFrom(this.openvr.devices.pipe(take(1)));
    await writeText(JSON.stringify(this.ovrData, null, 2));
    alert('OVR data copied to clipboard');
  }

  clearV1Ids() {
    this.appSettings.updateSettings({ v1LighthouseIdentifiers: {} });
  }

  async setAppFrameLimit(limits: number | null) {
    await invoke('openvr_set_app_framelimit', {
      appId: 438100,
      limits: {
        additionalFramesToPredict: limits ?? 0,
        framesToThrottle: limits ?? 0,
      },
    });

    if (limits === null) {
      await sleep(300);
      await invoke('openvr_set_app_framelimit', {
        appId: 438100,
        limits: null,
      });
    }
  }

  async getAppFrameLimit(): Promise<void> {
    this.result = await invoke('openvr_get_app_framelimit', {
      appId: 438100,
    });
    console.warn('APP FRAME LIMIT RESULT', structuredClone(this.result));
  }
}

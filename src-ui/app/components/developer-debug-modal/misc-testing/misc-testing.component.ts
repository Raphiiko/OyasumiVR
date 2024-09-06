import { Component, Input, OnInit } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { OpenVRService } from '../../../services/openvr.service';
import { firstValueFrom, take } from 'rxjs';
import { writeText } from '@tauri-apps/api/clipboard';
import { AppSettingsService } from '../../../services/app-settings.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent implements OnInit {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(private openvr: OpenVRService, protected appSettings: AppSettingsService) {}

  ngOnInit(): void {}

  result: any;
  ovrData: any = {};

  async pullOvrData() {
    this.ovrData = await firstValueFrom(this.openvr.devices.pipe(take(1)));
    await writeText(JSON.stringify(this.ovrData, null, 2));
    alert('OVR data copied to clipboard');
  }

  clearV1Ids() {
    this.appSettings.updateSettings({ v1LighthouseIdentifiers: {} });
  }
}

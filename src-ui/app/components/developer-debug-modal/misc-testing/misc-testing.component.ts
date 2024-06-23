import { Component, Input, OnInit } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { invoke } from '@tauri-apps/api';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent implements OnInit {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor() {}

  ngOnInit(): void {}

  colorTemp = 6600;
  result: any;

  async setColorTemp(temp: number) {
    this.colorTemp = temp;
    this.result = await invoke('openvr_set_analog_color_temp', { temperature: this.colorTemp });
  }
}

import { Component, OnInit } from '@angular/core';
import { NVMLService } from '../../../../services/nvml.service';
import { WindowsService } from '../../../../services/windows.service';

@Component({
  selector: 'app-gpu-automations-view',
  templateUrl: './gpu-automations-view.component.html',
  styleUrls: ['./gpu-automations-view.component.scss'],
})
export class GpuAutomationsViewComponent implements OnInit {
  elevated: string = '';
  constructor(public nvml: NVMLService, public windows: WindowsService) {}

  async ngOnInit() {
    this.elevated = (await this.windows.isElevated()) ? 'ELEVATED' : 'NOT ELEVATED';
  }
}

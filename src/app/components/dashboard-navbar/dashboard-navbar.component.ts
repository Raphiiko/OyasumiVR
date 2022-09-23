import { Component, OnInit } from '@angular/core';
import { combineLatest, map, Observable, startWith } from 'rxjs';
import { LighthouseService } from 'src/app/services/lighthouse.service';
import { AppSettingsService } from 'src/app/services/app-settings.service';
import { GpuAutomationsService } from '../../services/gpu-automations.service';
import { fade } from '../../utils/animations';
import { NVMLService } from '../../services/nvml.service';
import { ElevatedSidecarService } from '../../services/elevated-sidecar.service';

@Component({
  selector: 'app-dashboard-navbar',
  templateUrl: './dashboard-navbar.component.html',
  styleUrls: ['./dashboard-navbar.component.scss'],
  animations: [fade()],
})
export class DashboardNavbarComponent implements OnInit {
  settingErrors: Observable<boolean>;
  gpuAutomationsErrors: Observable<boolean>;
  constructor(
    private settingsService: AppSettingsService,
    private lighthouse: LighthouseService,
    private gpuAutomations: GpuAutomationsService,
    private nvml: NVMLService,
    private sidecar: ElevatedSidecarService,
  ) {
    this.settingErrors = combineLatest([
      this.lighthouse.consoleStatus.pipe(
        map((status) => !['UNKNOWN', 'SUCCESS', 'CHECKING'].includes(status)),
        startWith(false)
      ),
    ]).pipe(map((errorAreas: boolean[]) => !!errorAreas.find((a) => a)));
    this.gpuAutomationsErrors = combineLatest([
      this.gpuAutomations.isEnabled(),
      this.nvml.status,
      this.sidecar.sidecarRunning
    ]).pipe(
      map(([gpuAutomationsEnabled, nvmlStatus, sidecarRunning]) => {
        return gpuAutomationsEnabled && (nvmlStatus === 'ELEVATION_SIDECAR_INACTIVE' || !sidecarRunning);
      })
    );
  }

  ngOnInit(): void {}
}

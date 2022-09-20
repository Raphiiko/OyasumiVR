import { Component, OnInit } from '@angular/core';
import { combineLatest, map, Observable, startWith } from 'rxjs';
import { LighthouseService } from 'src/app/services/lighthouse.service';
import { AppSettingsService } from 'src/app/services/app-settings.service';
import { WindowsService } from '../../services/windows.service';
import { GpuAutomationsService } from '../../services/gpu-automations.service';
import { fade } from '../../utils/animations';

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
    private windows: WindowsService,
    private gpuAutomations: GpuAutomationsService
  ) {
    this.settingErrors = combineLatest([
      this.lighthouse.consoleStatus.pipe(
        map((status) => !['UNKNOWN', 'SUCCESS', 'CHECKING'].includes(status)),
        startWith(false)
      ),
    ]).pipe(map((errorAreas: boolean[]) => !!errorAreas.find((a) => a)));
    this.gpuAutomationsErrors = combineLatest([
      this.gpuAutomations.isEnabled(),
      this.windows.isElevated,
    ]).pipe(
      map(([gpuAutomationsEnabled, runningAsAdmin]) => {
        return gpuAutomationsEnabled && !runningAsAdmin;
      })
    );
  }

  ngOnInit(): void {}
}

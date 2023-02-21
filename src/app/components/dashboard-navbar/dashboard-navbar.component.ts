import { Component, OnInit } from '@angular/core';
import { asyncScheduler, combineLatest, map, Observable, startWith, throttleTime } from 'rxjs';
import { LighthouseService } from 'src/app/services/lighthouse.service';
import { AppSettingsService } from 'src/app/services/app-settings.service';
import { GpuAutomationsService } from '../../services/gpu-automations.service';
import { fade } from '../../utils/animations';
import { NVMLService } from '../../services/nvml.service';
import { ElevatedSidecarService } from '../../services/elevated-sidecar.service';
import { UpdateService } from '../../services/update.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard-navbar',
  templateUrl: './dashboard-navbar.component.html',
  styleUrls: ['./dashboard-navbar.component.scss'],
  animations: [fade()],
})
export class DashboardNavbarComponent implements OnInit {
  settingErrors: Observable<boolean>;
  gpuAutomationsErrors: Observable<boolean>;
  updateAvailable: Observable<boolean>;

  constructor(
    private settingsService: AppSettingsService,
    private lighthouse: LighthouseService,
    private gpuAutomations: GpuAutomationsService,
    private nvml: NVMLService,
    private sidecar: ElevatedSidecarService,
    private update: UpdateService,
    private router: Router
  ) {
    this.updateAvailable = this.update.updateAvailable.pipe(map((a) => !!a.manifest));
    this.settingErrors = combineLatest([
      this.lighthouse.consoleStatus.pipe(
        map((status) => !['UNKNOWN', 'SUCCESS', 'CHECKING'].includes(status)),
        startWith(false)
      ),
    ]).pipe(map((errorAreas: boolean[]) => !!errorAreas.find((a) => a)));
    this.gpuAutomationsErrors = combineLatest([
      this.gpuAutomations.isEnabled(),
      this.nvml.status,
      this.sidecar.sidecarRunning,
      this.gpuAutomations.msiAfterburnerStatus,
      this.gpuAutomations.msiAfterburnerConfig,
    ]).pipe(
      throttleTime(300, asyncScheduler, { trailing: true, leading: true }),
      map(
        ([
          gpuAutomationsEnabled,
          nvmlStatus,
          sidecarRunning,
          msiAfterburnerStatus,
          msiAfterburnerConfig,
        ]) => {
          // Global
          if (!gpuAutomationsEnabled) return false;
          if (!sidecarRunning) return true;
          // NVML
          if (
            [
              'ELEVATION_SIDECAR_INACTIVE',
              'NO_PERMISSION',
              'NVML_UNKNOWN_ERROR',
              'UNKNOWN_ERROR',
            ].includes(nvmlStatus)
          )
            return true;
          // Afterburner
          if (
            (msiAfterburnerConfig.onSleepDisableProfile > 0 ||
              msiAfterburnerConfig.onSleepEnableProfile > 0) &&
            [
              'NOT_FOUND',
              'INVALID_EXECUTABLE',
              'PERMISSION_DENIED',
              'INVALID_FILENAME',
              'INVALID_SIGNATURE',
              'UNKNOWN_ERROR',
            ].includes(msiAfterburnerStatus)
          )
            return true;
          // No errors found
          return false;
        }
      )
    );
  }

  ngOnInit(): void {}

  logoClicked = 0;

  onLogoClick() {
    if (this.logoClicked++ > 5) {
      this.router.navigate(['/sleepDebug']);
    }
  }
}

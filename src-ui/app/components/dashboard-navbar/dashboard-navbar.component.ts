import { Component, OnInit } from '@angular/core';
import { asyncScheduler, combineLatest, map, Observable, startWith, throttleTime } from 'rxjs';
import { LighthouseConsoleService } from 'src-ui/app/services/lighthouse-console.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { GpuAutomationsService } from '../../services/gpu-automations.service';
import { fade } from '../../utils/animations';
import { NvmlService } from '../../services/nvml.service';
import { ElevatedSidecarService } from '../../services/elevated-sidecar.service';
import { UpdateService } from '../../services/update.service';
import { Router } from '@angular/router';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { BackgroundService } from '../../services/background.service';
import { DisplayBrightnessControlAutomationService } from '../../services/brightness-control/display-brightness/display-brightness-control-automation.service';
import { flatten } from 'lodash';
import { OscService } from '../../services/osc.service';
import { invoke } from '@tauri-apps/api';
import { ImageBrightnessControlAutomationService } from '../../services/brightness-control/image-brightness/image-brightness-control-automation.service';

function slideMenu(name = 'slideMenu', length = '.2s ease', root = true) {
  return trigger(name, [
    transition(':enter', [
      style({
        transform: root ? 'translateX(-100%)' : 'translateX(100%)',
        opacity: 0,
      }),
      animate(
        length,
        style({
          transform: 'translateX(0)',
          opacity: 1,
        })
      ),
    ]),
    transition(':leave', [
      style({
        transform: 'translateX(0)',
        opacity: 1,
        position: 'absolute',
        width: '100%',
        top: 0,
        left: 0,
      }),
      animate(
        length,
        style({
          transform: root ? 'translateX(-100%)' : 'translateX(100%)',
          opacity: 0,
          width: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
        })
      ),
    ]),
  ]);
}

function blurMenu(name = 'blurMenu', length = '.2s ease') {
  return trigger(name, [
    state(
      'active',
      style({
        transform: 'translateX(0)',
        filter: 'blur(0)',
        width: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      })
    ),
    state(
      'inactive',
      style({
        'pointer-events': 'none',
        transform: 'translateX(-2.5em)',
        width: '100%',
        filter: 'blur(1em)',
        position: 'absolute',
        top: 0,
        left: 0,
      })
    ),
    transition('inactive => active', [
      style({
        transform: 'translateX(-2.5em)',
        filter: 'blur(1em)',
      }),
      animate(
        length,
        style({
          transform: 'translateX(0)',
          filter: 'blur(0)',
        })
      ),
    ]),
    transition('active => inactive', [
      style({
        transform: 'translateX(0)',
        position: 'absolute',
        width: '100%',
        top: 0,
        left: 0,
        filter: 'blur(0)',
      }),
      animate(
        length,
        style({
          transform: 'translateX(-2.5em)',
          width: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          filter: 'blur(1em)',
        })
      ),
    ]),
  ]);
}

type SubMenu = 'GENERAL' | 'VRCHAT' | 'HARDWARE';

@Component({
  selector: 'app-dashboard-navbar',
  templateUrl: './dashboard-navbar.component.html',
  styleUrls: ['./dashboard-navbar.component.scss'],
  animations: [
    fade(),
    // slideMenu('rootMenu', '.2s ease', true),
    blurMenu('rootMenu', '.2s ease'),
    slideMenu('subMenu', '.2s ease', false),
  ],
})
export class DashboardNavbarComponent implements OnInit {
  settingErrors: Observable<boolean>;
  gpuAutomationsErrors: Observable<boolean>;
  updateAvailable: Observable<boolean>;
  subMenu: SubMenu = 'GENERAL';

  constructor(
    private settingsService: AppSettingsService,
    private lighthouse: LighthouseConsoleService,
    private gpuAutomations: GpuAutomationsService,
    private nvml: NvmlService,
    private sidecar: ElevatedSidecarService,
    private update: UpdateService,
    private osc: OscService,
    protected router: Router,
    protected background: BackgroundService,
    protected displayBrightnessAutomation: DisplayBrightnessControlAutomationService,
    protected imageBrightnessAutomation: ImageBrightnessControlAutomationService
  ) {
    this.updateAvailable = this.update.updateAvailable.pipe(map((a) => !!a.manifest));
    this.settingErrors = combineLatest([
      this.lighthouse.consoleStatus.pipe(
        map((status) => !['UNKNOWN', 'SUCCESS', 'CHECKING'].includes(status)),
        startWith(false)
      ),
      this.osc.addressValidation.pipe(
        map((validation) => flatten(Object.values(validation)).length > 0)
      ),
    ]).pipe(map((errorAreas: boolean[]) => !!errorAreas.find((a) => a)));
    this.gpuAutomationsErrors = combineLatest([
      this.gpuAutomations.isEnabled(),
      this.nvml.status,
      this.sidecar.sidecarStarted,
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
          // Nvml
          if (
            [
              'ELEVATION_SIDECAR_INACTIVE',
              'NO_PERMISSION',
              'Nvml_UNKNOWN_ERROR',
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

  async ngOnInit(): Promise<void> {
    // setTimeout(async () => {
    //   await invoke('lighthouse_scan_devices');
    //   setInterval(async () => {
    //     await invoke('lighthouse_scan_devices');
    //   }, 10500);
    // }, 1000);
  }

  logoClicked = 0;

  async onLogoClick() {
    if (++this.logoClicked >= 3) {
      this.logoClicked = 0;
      invoke('add_notification', {
        message: 'THIS IS A TEST NOTIFICATION\nWHOOOOOOOOOO',
        duration: 5000,
      });
    }
  }

  openSubMenu(subMenu: SubMenu) {
    this.subMenu = subMenu;
  }

  pathIsActive(strings: string[]): boolean {
    return strings.some((s) =>
      this.router.isActive('/dashboard/' + s, {
        matrixParams: 'ignored',
        queryParams: 'ignored',
        paths: 'subset',
        fragment: 'ignored',
      })
    );
  }
}

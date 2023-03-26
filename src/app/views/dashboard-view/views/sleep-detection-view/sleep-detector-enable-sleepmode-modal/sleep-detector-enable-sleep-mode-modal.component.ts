import { Component, HostBinding, HostListener, OnDestroy, OnInit } from '@angular/core';
import { SimpleModalComponent, SimpleModalService } from 'ngx-simple-modal';
import { fade, fadeUp, triggerChildren } from '../../../../../utils/animations';
import { SelectBoxItem } from '../../../../../components/select-box/select-box.component';
import { AutomationConfigService } from '../../../../../services/automation-config.service';
import { filter, Subject, takeUntil } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfigs,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../../../../models/automations';
import { SleepDetectorCalibrationModalComponent } from '../sleep-detector-calibration-modal/sleep-detector-calibration-modal.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { Router } from '@angular/router';

export interface SleepDetectorEnableSleepModeModalInputModel {}

export interface SleepDetectorEnableSleepModeModalOutputModel {}

@Component({
  selector: 'app-time-enable-sleepmode-modal',
  templateUrl: './sleep-detector-enable-sleep-mode-modal.component.html',
  styleUrls: ['./sleep-detector-enable-sleep-mode-modal.component.scss'],
  animations: [fadeUp(), fade(), triggerChildren()],
})
export class SleepDetectorEnableSleepModeModalComponent
  extends SimpleModalComponent<
    SleepDetectorEnableSleepModeModalInputModel,
    SleepDetectorEnableSleepModeModalOutputModel
  >
  implements OnInit, OnDestroy, SleepDetectorEnableSleepModeModalInputModel
{
  private destroy$: Subject<void> = new Subject<void>();
  sensitivityOptions: SelectBoxItem[] = [
    {
      id: 'LOWEST',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.LOWEST',
    },
    {
      id: 'LOW',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.LOW',
    },
    {
      id: 'MEDIUM',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.MEDIUM',
    },
    {
      id: 'HIGH',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.HIGH',
    },
    {
      id: 'HIGHEST',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.HIGHEST',
    },
  ];
  sensitivityOption?: SelectBoxItem;

  automationConfigs?: AutomationConfigs;
  notificationsEnabled = false;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(
    private settingsService: AppSettingsService,
    private automationConfigService: AutomationConfigService,
    private modalService: SimpleModalService,
    private router: Router
  ) {
    super();
  }

  @HostListener('click', ['$event'])
  async onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'notificationSettingsLink') return;
    event.preventDefault();
    await this.router.navigate(['/dashboard/settings'], { fragment: 'NOTIFICATIONS' });
    await this.close();
  }

  ngOnInit(): void {
    this.automationConfigService.configs.pipe(takeUntil(this.destroy$)).subscribe((configs) => {
      this.automationConfigs = configs;
      this.sensitivityOption = this.sensitivityOptions.find(
        (o) => o.id === configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity
      );
      if (!this.sensitivityOption) this.setSensitivityOption('MEDIUM');
    });
    this.settingsService.settings.pipe(takeUntil(this.destroy$)).subscribe((settings) => {
      this.notificationsEnabled =
        settings.enableXSOverlayNotifications || settings.enableDesktopNotifications;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }

  save() {
    this.result = this;
    this.close();
  }

  calibrate() {
    this.modalService
      .addModal(
        SleepDetectorCalibrationModalComponent,
        {
          calibrationValue:
            this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue ??
            AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue,
        },
        {
          closeOnEscape: false,
          closeOnClickOutside: false,
        }
      )
      .pipe(filter((data) => !!data))
      .subscribe(async (data) => {
        await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
          'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
          {
            calibrationValue: data.calibrationValue,
          }
        );
      });
  }

  async setSensitivityOption(id: string | undefined) {
    this.sensitivityOption = this.sensitivityOptions.find((o) => o.id === id);
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        sensitivity:
          (this.sensitivityOption?.id as 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST') ??
          'MEDIUM',
      }
    );
  }

  async toggleSleepCheck() {
    if (!this.notificationsEnabled) return;
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        sleepCheck: !this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sleepCheck,
      }
    );
  }
}

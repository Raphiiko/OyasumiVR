import { Component, DestroyRef, HostBinding, HostListener, OnInit } from '@angular/core';
import { fade, fadeUp, triggerChildren } from '../../../../../utils/animations';
import { SelectBoxItem } from '../../../../../components/select-box/select-box.component';
import { AutomationConfigService } from '../../../../../services/automation-config.service';
import { filter } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfigs,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../../../../models/automations';
import { SleepDetectorCalibrationModalComponent } from '../sleep-detector-calibration-modal/sleep-detector-calibration-modal.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { Router } from '@angular/router';
import { debounce } from 'typescript-debounce-decorator';
import { BaseModalComponent } from '../../../../../components/base-modal/base-modal.component';
import { ModalService } from '../../../../../services/modal.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { cloneDeep } from 'lodash';

export interface SleepDetectorEnableSleepModeModalInputModel {}

export interface SleepDetectorEnableSleepModeModalOutputModel {}

@Component({
  selector: 'app-time-enable-sleepmode-modal',
  templateUrl: './sleep-detector-enable-sleep-mode-modal.component.html',
  styleUrls: ['./sleep-detector-enable-sleep-mode-modal.component.scss'],
  animations: [fadeUp(), fade(), triggerChildren()],
})
export class SleepDetectorEnableSleepModeModalComponent
  extends BaseModalComponent<
    SleepDetectorEnableSleepModeModalInputModel,
    SleepDetectorEnableSleepModeModalOutputModel
  >
  implements OnInit, SleepDetectorEnableSleepModeModalInputModel
{
  protected sensitivityOptions: SelectBoxItem[] = [
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
  protected sensitivityOption: SelectBoxItem | undefined;
  protected activationWindowStart = '00:00';
  protected activationWindowEnd = '00:00';
  protected automationConfigs?: AutomationConfigs;

  @HostBinding('[@fadeUp]')
  protected get fadeUp() {
    return;
  }

  constructor(
    private settingsService: AppSettingsService,
    private automationConfigService: AutomationConfigService,
    private modalService: ModalService,
    private router: Router,
    private destroyRef: DestroyRef
  ) {
    super();
  }

  @HostListener('click', ['$event'])
  async onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'notificationSettingsLink') return;
    event.preventDefault();
    await this.router.navigate(['/dashboard/settings/notifications']);
    await this.close();
  }

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.automationConfigs = configs;
        this.sensitivityOption = this.sensitivityOptions.find(
          (o) => o.id === configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity
        );
        if (!this.sensitivityOption) this.setSensitivityOption('MEDIUM');
        this.activationWindowStart =
          configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowStart
            .map((v) => v.toString().padStart(2, '0'))
            .join(':');
        this.activationWindowEnd = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowEnd
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
      });
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
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        sleepCheck: !this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sleepCheck,
      }
    );
  }

  @debounce(250)
  async onDetectionWindowChange(value: number) {
    if (value < 15 || value > 60) return;
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        detectionWindowMinutes: value,
      }
    );
  }

  async onChangeActivationWindowStart(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        activationWindowStart: parsedValue,
      }
    );
  }

  async onChangeActivationWindowEnd(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        activationWindowEnd: parsedValue,
      }
    );
  }

  async toggleActivationWindow() {
    // Toggle the activation window
    const config: Partial<SleepModeEnableForSleepDetectorAutomationConfig> = {
      activationWindow:
        !this.automationConfigs?.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR?.activationWindow,
    };
    // Reset the window back to default when turning off the activation window
    if (!config.activationWindow) {
      config.activationWindowStart = cloneDeep(
        AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowStart
      );
      config.activationWindowEnd = cloneDeep(
        AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowEnd
      );
    }
    // Apply & Save
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      config
    );
  }
}
